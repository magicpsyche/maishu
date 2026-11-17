import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenSandbox, connectWorkReadonly, optionsFromEnvironment, sandboxProvider } from "../src/opensandbox";
import { mockSdkServer } from "./sdk-http";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture(enabled = true) {
  const files = new Map<string, Uint8Array>([["/run/oma-managed/ready", Buffer.from("oma-managed-v2")]]);
  const requests: Record<string, unknown>[] = [];
  let locator: Record<string, unknown> | undefined;
  let state = "running";
  let failWrite = false;
  let absent = false;
  const client = { id: "sb-management", commands: { run: vi.fn(() => { throw Error("shell dispatch forbidden"); }) },
    files: {
      readBytes: vi.fn(async (path: string) => { if (!files.has(path)) throw Object.assign(Error("missing"), { statusCode: 404 }); return files.get(path)!; }),
      writeFiles: vi.fn(async (entries: Array<{ path: string; data: Uint8Array; mode: number }>) => {
        if (failWrite) throw Error("transport secret must be redacted");
        for (const entry of entries) {
          expect(entry.mode).toBe(600); files.set(entry.path, entry.data);
          if (!entry.path.endsWith(".go")) continue;
          const path = entry.path.slice(0, -3);
          const request = JSON.parse(Buffer.from(files.get(path + ".json")!).toString()); requests.push(request);
          let result: Record<string, unknown> = { ok: true };
          if (request.op === "start") {
            if (locator && state === "running") result = { ok: false, error: "management worker busy" };
            else { state = "running"; locator = { id: request.id, epoch: "epoch", pid: 41, identity: request.identity, status: state, sandboxId: client.id, holderHash: "a".repeat(64) }; result = { ok: true, ...locator }; }
          } else if (request.op === "inspect-slot") result = { ok: true, locator: { ...locator, status: state } };
          else if (request.target !== locator?.id || request.epoch !== locator?.epoch || JSON.stringify(request.identity) !== JSON.stringify(locator?.identity)
            || (request.holderHash !== undefined && request.holderHash !== locator?.holderHash)) result = { ok: false, error: "management request failed" };
          else if (request.op === "status") result = { ok: true, status: state };
          else if (request.op === "kill") state = "exited";
          files.set(path + ".response.json", Buffer.from(JSON.stringify(result)));
        }
      }),
      moveFiles: vi.fn(async (entries: Array<{ src: string; dest: string }>) => {
        for (const entry of entries) {
          const bytes = files.get(entry.src)!; files.delete(entry.src);
          await client.files.writeFiles([{ path: entry.dest, data: bytes, mode: 600 }]);
        }
      }),
    }, getInfo: vi.fn(async () => { if (absent) throw Object.assign(Error("gone"), { statusCode: 404 }); return {}; }), kill: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
  };
  const sandbox = new OpenSandbox(client as never, optionsFromEnvironment({ OPENSANDBOX_RUNTIME: "docker", ...(enabled ? { OPENSANDBOX_MANAGED_BOOTSTRAP: "1" } : {}) }));
  return { sandbox, client, requests, files, failWrites: () => { failWrite = true; }, disappear: () => { absent = true; } };
}
const identity = { workspaceId: "w", sessionId: "s", workId: "work", attemptId: "claim:1" };
const spec = { command: "/usr/local/bin/node", args: ["-e", "setInterval(()=>{},1000)"], env: { ONLY: "literal" } };

describe("OpenSandbox native management file plane", () => {
  it("starts with literal replacement environment, recovers exact identity and rejects forged locators", async () => {
    const f = fixture(); const handle = await f.sandbox.startManagedProcess(spec, identity);
    expect(f.requests[0]).toMatchObject({ op: "start", spec, identity, sandboxId: "sb-management" });
    expect(await handle.getStatus()).toBe("running");
    await expect(f.sandbox.startManagedProcess(spec, identity)).rejects.toThrow("busy");
    const locator = await f.sandbox.inspectManagedProcessSlot();
    await expect(f.sandbox.restoreManagedProcess({ ...locator, sandboxId: "other" })).rejects.toThrow("another sandbox");
    await expect(f.sandbox.restoreManagedProcess({ ...locator, epoch: "forged" })).rejects.toThrow();
    await expect(f.sandbox.restoreManagedProcess({ ...locator, holderHash: "b".repeat(64) })).rejects.toThrow();
    const restored = await f.sandbox.restoreManagedProcess(locator);
    await restored.kill("SIGKILL"); expect(await restored.getStatus()).toBe("exited");
    expect(f.client.commands.run).not.toHaveBeenCalled(); await f.sandbox.destroy();
    expect(f.client.files.moveFiles).toHaveBeenCalled();
  });
  it("requires explicit trusted bootstrap and never retries uncertain starts or falls back to shell", async () => {
    const disabled = fixture(false); await expect(disabled.sandbox.startManagedProcess(spec, identity)).rejects.toThrow("Trusted");
    expect(disabled.client.files.writeFiles).not.toHaveBeenCalled();
    const f = fixture(); f.failWrites();
    await expect(f.sandbox.startManagedProcess(spec, identity)).rejects.toThrow("outcome unknown");
    await expect(f.sandbox.startManagedProcess(spec, identity)).rejects.toThrow("unresolved");
    expect(f.client.files.writeFiles).toHaveBeenCalledTimes(1); expect(f.client.commands.run).not.toHaveBeenCalled();
    await f.sandbox.destroy(); await disabled.sandbox.destroy();
  });
  it("treats only exact provider absence as exited after the file plane fails", async () => {
    const f = fixture(); const handle = await f.sandbox.startManagedProcess(spec, identity);
    f.failWrites(); await expect(handle.getStatus()).rejects.toThrow();
    f.disappear(); expect(await handle.getStatus()).toBe("exited"); await handle.kill("SIGKILL");
    await f.sandbox.destroy();
  });
  it("uses the preinstalled entrypoint and verifies management readiness before publishing allocation", async () => {
    const server = mockSdkServer();
    server.override = call => call.url.pathname.endsWith("/files/download") ? new Response("oma-managed-v2") : undefined;
    const sandbox = await sandboxProvider.create({ sessionId: "s", workdir: "/workspace" }, { OPENSANDBOX_DOMAIN: "control.test:8080", OPENSANDBOX_RUNTIME: "docker", OPENSANDBOX_MANAGED_BOOTSTRAP: "1" });
    const creation = server.calls.find(call => call.method === "POST" && call.url.pathname.endsWith("/sandboxes"));
    expect(creation?.body).toMatchObject({ entrypoint: ["/usr/local/bin/maishu-managed-init"] });
    expect(server.calls.filter(call => call.url.pathname === "/command")).toHaveLength(1); // workspace pwd only
    await sandbox.destroy();
  });
  it("attaches readonly using GET only, without resume/renew/commands or workspace hydration", async () => {
    const server = mockSdkServer();
    const result = await connectWorkReadonly({ provider: "opensandbox", runtimeId: "sb-1" }, { sessionId: "s", workdir: "/workspace" }, { OPENSANDBOX_DOMAIN: "control.test:8080", OPENSANDBOX_RUNTIME: "docker", OPENSANDBOX_MANAGED_BOOTSTRAP: "1" });
    expect(result).not.toBe("gone");
    expect(server.calls.every(call => call.method === "GET")).toBe(true);
    expect(server.calls.some(call => call.url.pathname === "/command")).toBe(false);
  });
  it("does not treat a paused runtime or a provider read error as gone", async () => {
    const server = mockSdkServer(); const env = { OPENSANDBOX_DOMAIN: "control.test:8080", OPENSANDBOX_RUNTIME: "docker", OPENSANDBOX_MANAGED_BOOTSTRAP: "1" };
    server.state = "Paused";
    await expect(connectWorkReadonly({ provider: "opensandbox", runtimeId: "sb-1" }, { sessionId: "s", workdir: "/workspace" }, env)).rejects.toThrow("running");
    expect(server.calls.every(call => call.method === "GET")).toBe(true);
    server.override = call => call.url.pathname.endsWith("/sb-1") ? Response.json({}, { status: 503 }) : undefined;
    await expect(connectWorkReadonly({ provider: "opensandbox", runtimeId: "sb-1" }, { sessionId: "s", workdir: "/workspace" }, env)).rejects.toThrow();
    server.override = call => call.url.pathname.endsWith("/sb-1") ? Response.json({}, { status: 404 }) : undefined;
    await expect(connectWorkReadonly({ provider: "opensandbox", runtimeId: "sb-1" }, { sessionId: "s", workdir: "/workspace" }, env)).resolves.toBe("gone");
  });
});
