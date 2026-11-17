import { describe, expect, it, vi } from "vitest";
import { NodeSessionSandboxes, type NodeSessionSandboxOptions } from "../../../packages/control-plane-node/src/lib/node-session-sandbox.js";

function fixture(changes: Record<string, unknown> = {}) {
  const attempt = { workspaceId: "w", sessionId: "s", executionId: "work", attemptId: "environment-work-claim:1", ownerId: "e", generation: 1 };
  const identity = { workspaceId: "w", sessionId: "s", workId: "work", attemptId: attempt.attemptId };
  const locator = { sandboxId: "physical", id: "process", epoch: "epoch", pid: 41, identity, holderHash: "a".repeat(64), status: "running", ...changes };
  const state = { phase: "running", handle: { provider: "opensandbox", runtimeId: "physical" }, runStartedAt: 1, latestSnapshot: { status: "none" }, stores: [], outputs: false, version: 1 };
  const resume = vi.fn(async () => { throw Error("resume forbidden"); });
  const create = vi.fn(async () => { throw Error("create forbidden"); });
  const runtime = { runtimeHandle: () => state.handle, inspectManagedProcessSlot: vi.fn(async () => locator),
    restoreManagedProcess: vi.fn(async () => ({ id: locator.id, pid: locator.pid, getStatus: async () => "running", kill: vi.fn() })),
    readFile: vi.fn(async () => "physical-generation"), exec: vi.fn(async () => { throw Error("exec forbidden"); }) };
  const read = vi.fn(async () => runtime);
  const sandboxes = new NodeSessionSandboxes({ provider: { name: "opensandbox", provider: { create, resume },
    connectWorkReadonly: read, context: () => ({ workspaceId: "w", sessionId: "s", workdir: "/workspace" }), env: {} },
    records: { load: async () => state, save: async () => true }, idlePauseMs: 60000,
  } as unknown as NodeSessionSandboxOptions);
  const input = { workspaceId: "w", session: { id: "s" }, environment: { id: "e" }, terminal: false, sourceAttempt: attempt,
    workAuthority: { attempt, holderHash: () => "a".repeat(64), isCurrent: async () => true, token: async () => { throw Error("token issue forbidden"); } } };
  return { reconnect: () => sandboxes.reconnectWork(input as never), read, runtime, resume, create, locator };
}
describe("OpenSandbox readonly Work reconnect authority", () => {
  it("uses only the explicit readonly capability and preserves a live exact holder", async () => {
    const f = fixture(); const result = await f.reconnect();
    expect(result).not.toBe("unavailable"); expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.create).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled(); expect(f.runtime.exec).not.toHaveBeenCalled();
    if (result !== "unavailable") {
      expect(await result.workAuthority.isCurrent()).toBe(true);
      f.locator.epoch = "restarted-launcher";
      expect(await result.workAuthority.isCurrent()).toBe(false);
    }
  });
  it.each([
    { holderHash: "b".repeat(64) },
    { sandboxId: "other-runtime" },
    { identity: { workspaceId: "other-tenant", sessionId: "s", workId: "work", attemptId: "environment-work-claim:1" } },
    { identity: { workspaceId: "w", sessionId: "s", workId: "work", attemptId: "environment-work-claim:2" } },
  ])("rejects a locator that cannot prove the source claim: %j", async changes => {
    const f = fixture(changes); await expect(f.reconnect()).rejects.toThrow("authorized source attempt");
    expect(f.runtime.restoreManagedProcess).not.toHaveBeenCalled();
  });
});
