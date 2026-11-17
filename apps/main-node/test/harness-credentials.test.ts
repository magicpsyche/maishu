import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { EncryptedHarnessCredentials } from "../../../packages/control-plane-node/src/lib/harness-credentials.js";
import { harnessCredentialRoutes } from "../../../packages/control-plane-node/src/lib/harness-credentials-http.js";
import { createNodeSecrets } from "../../../packages/control-plane-node/src/secrets.js";
import type { SandboxExecutor } from "@open-managed-agents/sandbox";
import { NodeManagedWorkspaceCheckpoints } from "../../../packages/control-plane-node/src/lib/node-managed-workspace-checkpoints.js";
import { InMemoryBlobStore } from "@open-managed-agents/blob-store";

class Store {
  rows = new Map<string, string>();
  async get(k: string) { return this.rows.get(k) ?? null; }
  async put(k: string, v: string) { this.rows.set(k, v); }
  async delete(k: string) { this.rows.delete(k); }
  async list(options?: { prefix?: string }) { return { keys: [...this.rows.keys()].filter(k => k.startsWith(options?.prefix ?? "")).map(name => ({ name })), list_complete: true }; }
  async compareAndSwap(k: string, old: string | null, next: string | null) {
    if ((this.rows.get(k) ?? null) !== old) return false;
    if (next === null) this.rows.delete(k); else this.rows.set(k, next);
    return true;
  }
}
function setup() {
  const kv = new Store();
  const cipher = createNodeSecrets("synthetic-credential-test-root").cipherFor("platform.harness.credentials");
  const manager = new EncryptedHarnessCredentials(kv, cipher);
  return { manager, kv };
}
const content = JSON.stringify({ tokens: { access_token: "synthetic-account-token" } });
const credential = { name: "代码账户", kind: "codex" as const, content, allowedAgentIds: ["agent_a"] };
function invocation(ref: string, extra: Record<string, unknown> = {}) {
  return { harness: "acp-sandbox", acp: { agent: { id: "codex-acp", command: "/usr/local/bin/maishu-harness", args: ["codex"], env: { MAISHU_AUTH_MODE: "native", MAISHU_CREDENTIAL_REF: ref }, ...extra } } };
}
function sandbox() {
  return { writeFileBytes: vi.fn(async () => undefined), exec: vi.fn(async () => "") } as unknown as SandboxExecutor;
}

describe("native harness credential boundaries", () => {
  it.each(["/", "/run", "/run/maishu-credentials/account", "/tmp", "/tmp/openma-harness-state", "/tmp/openma-harness-state/acp/session/native"])("refuses a workspace checkpoint covering private credentials: %s", async root => {
    const checkpoints = new NodeManagedWorkspaceCheckpoints({ sql: {} as never, blobs: new InMemoryBlobStore(), intervalMs: 1000 });
    const box = { ...sandbox(), resolveWorkspaceRoot: async () => root } as SandboxExecutor;
    await expect(checkpoints.port(box).checkpoint({ strategy: "checkpoint_restore", signal: new AbortController().signal } as never)).rejects.toThrow(/authentication directories/);
    expect(box.exec).not.toHaveBeenCalled();
  });
  it("encrypts all stored account content and never returns it", async () => {
    const { manager, kv } = setup();
    const saved = await manager.save("tenant_a", credential);
    expect(JSON.stringify(saved)).not.toContain("synthetic-account-token");
    expect(JSON.stringify([...kv.rows])).not.toContain("synthetic-account-token");
    expect(await manager.list("tenant_b")).toEqual([]);
    expect((await manager.list("tenant_a"))[0]).toEqual(saved);
    expect(JSON.stringify(await manager.list("tenant_a"))).not.toContain("content");
  });
  it("checks workspace, agent, identity and controlled command before any upload", async () => {
    const { manager } = setup();
    const saved = await manager.save("tenant_a", credential);
    const box = sandbox();
    const base = { workspaceId: "tenant_a", agentId: "agent_a", sessionId: "s", sandbox: box, agentConfig: invocation(saved.id) };
    await expect(manager.materialize({ ...base, workspaceId: "tenant_b" })).rejects.toThrow(/不存在|不可访问/);
    await expect(manager.materialize({ ...base, agentId: "agent_b" })).rejects.toThrow(/未获准/);
    await expect(manager.materialize({ ...base, agentConfig: invocation(saved.id, { id: "claude-acp" }) })).rejects.toThrow(/不匹配/);
    await expect(manager.materialize({ ...base, agentConfig: invocation(saved.id, { command: "sh" }) })).rejects.toThrow(/受控/);
    expect(box.writeFileBytes).not.toHaveBeenCalled();
    await manager.materialize(base);
    expect(box.writeFileBytes).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\/tmp\/maishu-inject-/), new TextEncoder().encode(content));
    const command = vi.mocked(box.exec).mock.calls[0]![0];
    expect(command).not.toContain("synthetic-account-token");
    expect(command).toContain(`/run/maishu-credentials/${saved.id}/auth.json`);
    expect(command).not.toContain("/workspace/");
    expect(command).toContain("0o600");
    expect(command).toContain("O_NOFOLLOW");
  });
  it("updates with CAS, revokes future injection and validates authentication formats", async () => {
    const { manager } = setup();
    const saved = await manager.save("tenant_a", credential);
    await expect(manager.save("tenant_a", { ...credential, expectedRevision: "stale" }, saved.id)).rejects.toThrow(/已更新/);
    const updated = await manager.save("tenant_a", { ...credential, expectedRevision: saved.revision, allowWorkspace: true }, saved.id);
    expect(updated.revision).not.toBe(saved.revision);
    await manager.materialize({ workspaceId: "tenant_a", agentId: "agent_b", sessionId: "s", sandbox: sandbox(), agentConfig: invocation(saved.id) });
    await manager.remove("tenant_a", saved.id);
    await expect(manager.materialize({ workspaceId: "tenant_a", agentId: "agent_a", sessionId: "s", sandbox: sandbox(), agentConfig: invocation(saved.id) })).rejects.toThrow(/不存在/);
    await expect(manager.save("tenant_a", { ...credential, content: "invalid synthetic token" })).rejects.toThrow(/JSON/);
    await expect(manager.save("tenant_a", { ...credential, kind: "__proto__" as never })).rejects.toThrow(/类型/);
  });
  it("pins credential bytes to a Session but checks the current grant each execution", async () => {
    const { manager } = setup();
    const saved = await manager.save("tenant_a", credential);
    const box = sandbox();
    const base = { workspaceId: "tenant_a", agentId: "agent_a", sessionId: "session_old", sandbox: box, agentConfig: invocation(saved.id) };
    await manager.materialize(base);
    const rotated = await manager.save("tenant_a", { ...credential, content: '{"tokens":{"access_token":"synthetic-rotated"}}', expectedRevision: saved.revision }, saved.id);
    await manager.materialize(base);
    expect(vi.mocked(box.writeFileBytes).mock.calls[1]![1]).toEqual(new TextEncoder().encode(content));
    await manager.materialize({ ...base, sessionId: "session_new" });
    expect(new TextDecoder().decode(vi.mocked(box.writeFileBytes).mock.calls[2]![1])).toContain("synthetic-rotated");
    await manager.save("tenant_a", { ...credential, expectedRevision: rotated.revision, allowedAgentIds: [] }, saved.id);
    await expect(manager.materialize(base)).rejects.toThrow(/未获准/);
  });
  it("does not materialize a native credential in managed inference mode", async () => {
    const { manager } = setup();
    const saved = await manager.save("tenant_a", credential);
    const box = sandbox();
    const config = invocation(saved.id);
    config.acp.agent.env.MAISHU_AUTH_MODE = "managed";
    await manager.materialize({ workspaceId: "tenant_a", agentId: "agent_a", sessionId: "s", sandbox: box, agentConfig: config });
    expect(box.writeFileBytes).not.toHaveBeenCalled();
  });
  it("requires instance admin and redacts invalid request errors", async () => {
    const { manager } = setup();
    const app = new Hono<{ Variables: { tenant_id: string; user_id?: string } }>();
    app.use("*", async (c, next) => { c.set("tenant_id", "tenant_a"); c.set("user_id", c.req.header("x-test-user")); await next(); });
    app.route("/credentials", harnessCredentialRoutes({ controller: manager, administratorIds: ["admin"] }));
    expect((await app.request("/credentials", { headers: { "x-test-user": "member" } })).status).toBe(403);
    const created = await app.request("/credentials", { method: "POST", headers: { "x-test-user": "admin", "content-type": "application/json" }, body: JSON.stringify(credential) });
    expect(created.status).toBe(201);
    expect(await created.text()).not.toContain("synthetic-account-token");
    const invalid = await app.request("/credentials", { method: "POST", headers: { "x-test-user": "admin" }, body: 'synthetic-account-token' });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("synthetic-account-token");
  });
});
