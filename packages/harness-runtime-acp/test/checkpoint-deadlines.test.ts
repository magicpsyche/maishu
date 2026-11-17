import { afterEach, expect, it, vi } from "vitest";
import { createWorkTurnFinalizer } from "../src/work-finalization-input-http.js";

afterEach(() => vi.useRealTimers());
const gap = () => Response.json({ type: "gap", reason: "consumed_turn_without_terminal", revision: 8 }, { status: 409 });
const prepared = () => Response.json({ type: "prepared", turnId: "turn", revision: 8 });
function untilResponse(signal: AbortSignal, delay?: number) {
  return new Promise<Response>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => { if (timer !== undefined) clearTimeout(timer); reject(signal.reason); };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    if (delay !== undefined) timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(prepared()); }, delay);
  });
}
function fixture(options: { checkpointRequestTimeoutMs?: number; checkpointDelay?: number; signal?: AbortSignal; unknownTerminal?: boolean } = {}) {
  const calls: string[] = [];
  const finalizer = createWorkTurnFinalizer({ apiBaseUrl: "https://control.test", sessionId: "session", sessionsToken: "synthetic-fixture", signal: options.signal ?? new AbortController().signal,
    ...(options.checkpointRequestTimeoutMs === undefined ? {} : { checkpointRequestTimeoutMs: options.checkpointRequestTimeoutMs }),
    fetch: async (url, init) => {
      const action = new URL(String(url)).pathname.split("/").at(-1)!; calls.push(action);
      if (action === "work-recovery") return gap();
      if (action === "work-checkpoint") return untilResponse(init!.signal!, options.checkpointDelay);
      if (action === "work-finalize" && options.unknownTerminal) return untilResponse(init!.signal!);
      throw new Error("Unexpected fixture request " + action);
    },
  });
  finalizer.admitted("turn");
  return { finalizer, calls };
}
it("lets a 65-second physical checkpoint finish within the trusted 75-second budget", async () => {
  vi.useFakeTimers();
  const f = fixture({ checkpointRequestTimeoutMs: 75_000, checkpointDelay: 65_000 });
  const checkpoint = f.finalizer.checkpoint("turn");
  const completed = expect(checkpoint).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(65_000); await completed;
  expect(f.calls).toEqual(["work-recovery", "work-checkpoint"]);
});
it("keeps the original default 30-second deadline and only one bounded retry", async () => {
  vi.useFakeTimers(); const f = fixture();
  const failed = expect(f.finalizer.checkpoint("turn")).rejects.toMatchObject({ name: "WorkFinalizationTransportError", outcome: "unknown" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.calls).toEqual(["work-recovery", "work-checkpoint"]);
  await vi.advanceTimersByTimeAsync(250);
  expect(f.calls).toEqual(["work-recovery", "work-checkpoint", "work-checkpoint"]);
  await vi.advanceTimersByTimeAsync(30_000); await failed;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.calls.filter(action => action === "work-checkpoint")).toHaveLength(2);
  expect(f.calls).not.toContain("work-finalize");
});
it("aborts a slow checkpoint immediately on claim loss without retrying or finalizing", async () => {
  vi.useFakeTimers(); const owner = new AbortController();
  const f = fixture({ checkpointRequestTimeoutMs: 75_000, checkpointDelay: 65_000, signal: owner.signal });
  const failed = expect(f.finalizer.checkpoint("turn")).rejects.toMatchObject({ outcome: "unknown", cause: { message: "claim lost" } });
  await vi.advanceTimersByTimeAsync(1_000); owner.abort(new Error("claim lost")); await failed;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.calls).toEqual(["work-recovery", "work-checkpoint"]);
});
it("retains per-turn single flight while a slow checkpoint is pending", async () => {
  vi.useFakeTimers(); const f = fixture({ checkpointRequestTimeoutMs: 75_000, checkpointDelay: 65_000 });
  const first = f.finalizer.checkpoint("turn"), second = f.finalizer.checkpoint("turn");
  const complete = expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  await vi.advanceTimersByTimeAsync(65_000); await complete;
  expect(f.calls).toEqual(["work-recovery", "work-checkpoint", "work-recovery"]);
});
it("keeps terminal writes at 30 seconds and never blindly retries an unknown terminal response", async () => {
  vi.useFakeTimers(); const f = fixture({ checkpointRequestTimeoutMs: 75_000, checkpointDelay: 1, unknownTerminal: true });
  const checkpoint = f.finalizer.checkpoint("turn"); await vi.advanceTimersByTimeAsync(1); await checkpoint;
  const failed = expect(f.finalizer.complete("turn")).rejects.toMatchObject({ name: "WorkFinalizationTransportError", action: "work-finalize", outcome: "unknown" });
  await vi.advanceTimersByTimeAsync(30_000); await failed;
  await expect(f.finalizer.complete("turn")).rejects.toThrow("Work checkpoint must precede terminal");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(f.calls).toEqual(["work-recovery", "work-checkpoint", "work-finalize"]);
});
