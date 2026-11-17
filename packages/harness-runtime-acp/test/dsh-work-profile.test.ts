import { expect, it, vi } from "vitest";
import { URL } from "node:url";
import type { AcpRuntime, AcpSession } from "@open-managed-agents/acp-runtime";
import { applyAcpPermissionMode } from "@openma/common/acp-runtime";
import { WorkTurnActivities } from "../src/node-work-composition.js";

const info = { name: "dsh-acp", version: "0.4.41" };
const modes = ["read-only", "workspace-write", "danger-full-access"];
const config = (value = "workspace-write") => [{ id: "mode", type: "select", category: "mode", currentValue: value,
  options: modes.map(value => ({ value, name: value })) }];
it.each([
  ["always_ask", "read-only"], ["auto", "workspace-write"], ["always_allow", "danger-full-access"],
] as const)("applies the installed pinned DSH profile with authoritative %s readback", async (mode, nativeModeId) => {
  const session = { agentInfo: info, configOptions: config(), setConfigOption: vi.fn(async (_id, value) => {
    session.configOptions = config(value); return session.configOptions;
  }) };
  await expect(applyAcpPermissionMode(session as never, { harnessId: "dsh-acp", mode })).resolves.toMatchObject({ status: "applied", nativeModeId, version: "0.4.41" });
  expect(session.setConfigOption).toHaveBeenCalledWith("mode", nativeModeId);
});
it.each(["0.4.40", "0.4.42", "0.2.1-rc.5"])("refuses unproven DSH adapter %s before dispatch", async version => {
  const setConfigOption = vi.fn();
  await expect(applyAcpPermissionMode({ agentInfo: { ...info, version }, configOptions: config(), setConfigOption } as never,
    { harnessId: "dsh-acp", mode: "auto" })).rejects.toMatchObject({ code: "unsupported", outcome: "not-dispatched" });
  expect(setConfigOption).not.toHaveBeenCalled();
});
it.each(["mode-mismatch", "unsupported"])("retains the native DSH %s readback barrier", async code => {
  const session = { agentInfo: info, configOptions: config(), async setConfigOption() { return code === "unsupported" ? [] : config("read-only"); } };
  await expect(applyAcpPermissionMode(session as never, { harnessId: "dsh-acp", mode: "always_allow" })).rejects.toMatchObject({ code, outcome: "unknown" });
});
it("retains the pending RPC barrier after a DSH deadline expires", async () => {
  let settle!: (value: unknown) => void;
  const session = { agentInfo: info, configOptions: config(), setConfigOption: vi.fn(() => new Promise(resolve => { settle = resolve; })) };
  await expect(applyAcpPermissionMode(session as never, { harnessId: "dsh-acp", mode: "auto", timeoutMs: 1 })).rejects.toMatchObject({ code: "timeout" });
  await expect(applyAcpPermissionMode(session as never, { harnessId: "dsh-acp", mode: "auto" })).rejects.toMatchObject({ code: "busy" });
  expect(session.setConfigOption).toHaveBeenCalledTimes(1); settle(config());
});

const done = { type: "promptComplete", response: { stopReason: "end_turn" } };
const command = { sessionUpdate: "tool_call", toolCallId: "bash", kind: "execute", status: "in_progress", rawInput: { command: "sleep .2; printf marker" } };
const result = (value: unknown) => ({ sessionUpdate: "tool_call_update", toolCallId: "bash", status: "completed",
  _meta: { dsh: { toolResult: { value } }, terminal_exit: { exit_code: 0 } } });
async function run(events: unknown[], agentInfo = info) {
  const activity = new WorkTurnActivities(); let callbacks: any;
  const runtime = activity.wrapRuntime({ async start(options) { callbacks = options; return { agentInfo,
    async *prompt() { yield* events; }, isAlive() { return true; },
  } as unknown as AcpSession; } } satisfies AcpRuntime);
  activity.admit("turn"); const session = await runtime.start({ agent: { command: "fixture" } });
  for await (const _ of session.prompt("offline fixture")) {}
  const context = { command: { turnId: "turn" }, signal: new AbortController().signal } as never;
  return { activity, callbacks: () => callbacks, context };
}
it.each([{ kind: "foreground", exitCode: 0, signal: null }, { kind: "foreground", exitCode: 1, signal: null },
  { kind: "foreground", exitCode: null, signal: "SIGTERM" }])("certifies actual DSH foreground process completion %j", async value => {
  const f = await run([command, result(value), done]);
  await expect(f.activity.drain(f.context)).resolves.toBeUndefined();
});
it.each([
  { kind: "promoted", jobId: "job", timeoutMs: 1 },
  { kind: "background", jobId: "job" },
  { kind: "foreground", jobId: "job", exitCode: 0 },
  { kind: "foreground", exitCode: null, signal: null }, {},
])("rejects DSH display terminal exit without actual foreground process completion %j", async value => {
  const f = await run([command, result(value), done]);
  await expect(f.activity.drain(f.context)).rejects.toThrow(/unproven/);
});
it("retains the DSH promotion marker across a later foreground-looking update", async () => {
  const f = await run([command, result({ kind: "promoted", jobId: "job" }), result({ kind: "foreground", exitCode: 0 }), done]);
  await expect(f.activity.drain(f.context)).rejects.toThrow(/unproven/);
});
it("rejects unknown DSH versions even with a foreground exit", async () => {
  const f = await run([command, result({ kind: "foreground", exitCode: 0 }), done], { ...info, version: "0.4.42" });
  await expect(f.activity.drain(f.context)).rejects.toThrow(/unproven/);
});
it("requires an actual join for DSH scheduler/extension/child tools", async () => {
  const f = await run([{ sessionUpdate: "tool_call", toolCallId: "schedule", kind: "other", status: "completed" }, done]);
  await expect(f.activity.drain(f.context)).rejects.toThrow(/unproven/);
});
it("refuses late DSH tool notifications while draining a real join", async () => {
  const f = await run([command, result({ kind: "foreground", exitCode: 0 }), done]);
  let finish!: () => void;
  f.activity.register("turn", "join", new Promise<void>(resolve => { finish = resolve; }));
  const draining = f.activity.drain(f.context);
  f.callbacks().onOutOfBandSessionUpdate(result({ kind: "foreground", exitCode: 0 })); finish();
  await expect(draining).rejects.toThrow(/after admission closed/);
});
it.each(["foreground", "promoted"] as const)("replays the captured real DSH %s protocol trace through Work drain", async variant => {
  const { readFileSync } = await import("node:fs");
  const trace = JSON.parse(readFileSync(new URL("./fixtures/dsh-native-0.4.41.json", import.meta.url), "utf8"));
  const f = await run([...trace[variant], done]);
  if (variant === "foreground") await expect(f.activity.drain(f.context)).resolves.toBeUndefined();
  else await expect(f.activity.drain(f.context)).rejects.toThrow(/unproven/);
});
it.each(["read", "edit", "search"])("accepts pinned DSH synchronous %s completion", async kind => {
  const f = await run([{ sessionUpdate: "tool_call", toolCallId: "file", kind, status: "in_progress" },
    { sessionUpdate: "tool_call_update", toolCallId: "file", status: "completed" }, done]);
  await expect(f.activity.drain(f.context)).resolves.toBeUndefined();
});
it.each([
  ["claude-acp", "@agentclientprotocol/claude-agent-acp", "0.94.0", ["default", "auto", "bypassPermissions"], "bypassPermissions"],
  ["codex-acp", "@agentclientprotocol/codex-acp", "1.8.0", ["read-only", "agent", "agent-full-access"], "agent-full-access"],
] as const)("preserves the upstream %s installed permission mapping", async (harnessId, name, version, choices, expected) => {
  const session = { agentInfo: { name, version }, configOptions: [{ ...config()[0], options: choices.map(value => ({ value, name: value })) }],
    async setConfigOption(_id: string, value: string) { session.configOptions[0]!.currentValue = value; return session.configOptions; } };
  await expect(applyAcpPermissionMode(session as never, { harnessId, mode: "always_allow" })).resolves.toMatchObject({ status: "applied", nativeModeId: expected });
});
