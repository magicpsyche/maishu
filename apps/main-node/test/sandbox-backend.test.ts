import { describe, expect, it, vi } from "vitest";
import { ConsoleSandboxBackend } from "../../../packages/control-plane-node/src/lib/console-sandbox-backend.js";
import { sandboxBackendRoutes } from "../../../packages/control-plane-node/src/lib/sandbox-backend-http.js";
import { createNodeSecrets } from "../../../packages/control-plane-node/src/secrets.js";
import type { SandboxProviderPort } from "@open-managed-agents/sandbox";
import { sandboxTokenSha256 } from "../../../packages/sandbox-gateway/src/sandbox-token.js";

class Store {
  rows = new Map<string, string>();
  async get(k: string) { return this.rows.get(k) ?? null; }
  async put(k: string, v: string) { this.rows.set(k, v); }
  async delete(k: string) { this.rows.delete(k); }
  async list() { return { keys: [], list_complete: true }; }
  async compareAndSwap(k: string, old: string | null, next: string | null) {
    if ((this.rows.get(k) ?? null) !== old) return false;
    if (next === null) this.rows.delete(k); else this.rows.set(k, next);
    return true;
  }
}
const context = (id: string) => ({ workspaceId: "tenant-a", sessionId: id, workdir: "/workspace" });
function setup() {
  const kv = new Store();
  const runtime = { exec: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), destroy: vi.fn(),
    capabilities: () => ({ suspendResume: "unsupported", hardTerminate: "supported", runtimeCheckpoints: [] }),
    runtimeHandle: () => ({ provider: "opensandbox", runtimeId: "box" }),
    status: vi.fn(), renewLease: vi.fn(), suspend: vi.fn(), resume: vi.fn(), checkpoint: vi.fn() };
  const provider = { create: vi.fn(async () => runtime), resume: vi.fn(async () => runtime), restore: vi.fn(async () => runtime) } as unknown as SandboxProviderPort;
  const cipher = createNodeSecrets("test-root-secret-not-production").cipherFor("platform.sandbox.backend");
  const env = { OPENSANDBOX_DOMAIN: "old-host:8808", OPENSANDBOX_API_KEY: "old-secret", OPENSANDBOX_RUNTIME: "docker", SANDBOX_IMAGE: "node:22-slim" };
  return { kv, provider, runtime, cipher, env, manager: new ConsoleSandboxBackend(kv, cipher, env, provider) };
}
async function update(manager: ConsoleSandboxBackend, domain = "new-host:8818") {
  const previous = await manager.read();
  return manager.save({ expectedRevision: previous.revision, settings: { ...previous.settings, domain }, apiKey: "new-secret" });
}

describe("versioned sandbox backend", () => {
  it("encrypts keys, redacts public responses and retains keys when omitted", async () => {
    const { manager, kv } = setup();
    const view = await update(manager);
    expect(view.credentialSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(JSON.stringify([...kv.rows])).not.toContain("new-secret");
    expect(JSON.stringify([...kv.rows])).not.toContain("old-secret");
    await manager.save({ expectedRevision: view.revision, settings: view.settings });
    const env = await manager.environmentFor(context("new"), false, {});
    expect(env.OPENSANDBOX_API_KEY).toBe("new-secret");
  });
  it("new sessions select the new backend while existing and legacy resumes stay pinned", async () => {
    const { manager, provider, env } = setup();
    await manager.provider().create(context("before"), env);
    await update(manager);
    await manager.provider().create(context("after"), env);
    await manager.provider().resume({ provider: "opensandbox", runtimeId: "old" }, context("before"), env);
    await manager.provider().resume({ provider: "opensandbox", runtimeId: "legacy" }, context("unbound-legacy"), env);
    expect(vi.mocked(provider.create).mock.calls.map(c => c[1].OPENSANDBOX_DOMAIN)).toEqual(["old-host:8808", "new-host:8818"]);
    expect(vi.mocked(provider.resume).mock.calls.map(c => c[2].OPENSANDBOX_DOMAIN)).toEqual(["old-host:8808", "old-host:8808"]);
  });
  it("preserves session bindings and the original environment across a manager restart", async () => {
    const { manager, kv, provider, cipher, env } = setup();
    await manager.environmentFor(context("bound"), false, env);
    await update(manager);
    const restarted = new ConsoleSandboxBackend(kv, cipher, { ...env, OPENSANDBOX_DOMAIN: "changed-env:9999" }, provider);
    expect((await restarted.environmentFor(context("bound"), true, env)).OPENSANDBOX_DOMAIN).toBe("old-host:8808");
    expect((await restarted.environmentFor(context("fresh"), false, env)).OPENSANDBOX_DOMAIN).toBe("new-host:8818");
  });
  it("pins missing provider keys and imports updated deployment settings only as a new revision", async () => {
    const { manager, kv, provider, cipher, env } = setup();
    await manager.environmentFor(context("old"), false, env);
    const newer = { ...env, OPENSANDBOX_MANAGED_BOOTSTRAP: "1", OPENSANDBOX_VOLUMES: '[{"mountPath":"/opt/worker"}]', OPENSANDBOX_DOMAIN: "new-deployment:8818" };
    const restarted = new ConsoleSandboxBackend(kv, cipher, newer, provider);
    const pinned = await restarted.environmentFor(context("old"), true, newer);
    expect(pinned.OPENSANDBOX_MANAGED_BOOTSTRAP).toBeUndefined(); expect(pinned.OPENSANDBOX_VOLUMES).toBeUndefined();
    expect(pinned.OPENSANDBOX_DOMAIN).toBe("old-host:8808");
    const before = await restarted.read();
    const imported = await restarted.importEnvironment(before.revision);
    expect(imported.revision).not.toBe(before.revision);
    const fresh = await restarted.environmentFor(context("new-import"), false, newer);
    expect(fresh.OPENSANDBOX_DOMAIN).toBe("new-deployment:8818"); expect(fresh.OPENSANDBOX_MANAGED_BOOTSTRAP).toBe("1");
    expect(fresh.OPENSANDBOX_VOLUMES).toBe(newer.OPENSANDBOX_VOLUMES);
    expect((await restarted.environmentFor(context("old"), true, newer)).OPENSANDBOX_VOLUMES).toBeUndefined();
  });
  it("CAS rejects concurrent stale saves and concurrent allocations select one revision", async () => {
    const { manager } = setup();
    const view = await manager.read();
    const results = await Promise.allSettled(["a:8818", "b:8818"].map(domain => manager.save({ expectedRevision: view.revision, settings: { ...view.settings, domain } })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const bound = await Promise.all([1, 2, 3].map(() => manager.environmentFor(context("same"), false, {})));
    expect(new Set(bound.map(e => e.OPENSANDBOX_DOMAIN)).size).toBe(1);
  });
  it("validates operator inputs without allocating compute", async () => {
    const { manager, provider } = setup(); const view = await manager.read();
    await expect(manager.save({ expectedRevision: view.revision, settings: { ...view.settings, domain: "user:password@host" } })).rejects.toThrow();
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("destroys the temporary sandbox when exec or duplex checks fail", async () => {
    const { manager, runtime } = setup(); const view = await manager.read();
    runtime.readFile.mockResolvedValue("wrong");
    await expect(manager.probe({ expectedRevision: view.revision, settings: view.settings })).rejects.toThrow("探针失败");
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
  });
  it("checks actual duplex bytes before reporting success, and clears explicit keys", async () => {
    const { manager, runtime } = setup(); const view = await manager.read();
    let content = "";
    runtime.writeFile.mockImplementation(async (_path, value) => { content = value; return ""; });
    runtime.readFile.mockImplementation(async () => content);
    runtime.exec.mockResolvedValue("maishu-probe");
    const kill = vi.fn(async () => undefined);
    Object.assign(runtime, { spawnDuplexProcess: async () => {
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      return { stdin: stream.writable, stdout: stream.readable, stderr: new ReadableStream(), kill, exited: Promise.resolve({ code: 0, signal: null }) };
    } });
    let running = true;
    let token = ""; let identity: Record<string, string> = {};
    const handle = { id: "managed", pid: 41, getStatus: async () => running ? "running" : "exited", kill: async () => { running = false; } };
    Object.assign(runtime, {
      managementBootstrapEnabled: () => true,
      startManagedProcess: async (spec: { env: Record<string, string> }, bound: Record<string, string>) => { token = spec.env.OPENMA_SANDBOX_TOKEN; identity = bound; return handle; },
      inspectManagedProcessSlot: async () => ({ id: "managed", pid: 41, sandboxId: "box", epoch: "e", identity, status: "running", holderHash: await sandboxTokenSha256(token) }),
      restoreManagedProcess: async () => handle,
    });
    const result = await manager.probe({ expectedRevision: view.revision, settings: view.settings });
    expect(result.stages).toContain("ACP 双向进程实际收发");
    expect(result.stages).toContain("安全管理进程启动、身份绑定、恢复与停止");
    expect(kill).toHaveBeenCalled(); expect(runtime.destroy).toHaveBeenCalledTimes(1);
    await manager.save({ expectedRevision: view.revision, settings: view.settings, apiKey: "" });
    expect((await manager.environmentFor(context("cleared"), false, {})).OPENSANDBOX_API_KEY).toBe("");
  });
});

describe("instance administrator sandbox routes", () => {
  it("does not allow arbitrary authenticated workspace members", async () => {
    const { manager } = setup();
    const app = sandboxBackendRoutes({ controller: manager, administratorIds: ["admin"] });
    expect((await app.request("/")).status).toBe(403);
  });
  it("allows only the deployment key and never returns its sandbox secret", async () => {
    const { manager } = setup();
    const app = sandboxBackendRoutes({ controller: manager, administratorIds: [], deploymentKey: "deployment-key" });
    const r = await app.request("/", { headers: { "x-api-key": "deployment-key" } });
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain("old-secret");
  });
});
