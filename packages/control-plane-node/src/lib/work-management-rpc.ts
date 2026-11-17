// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
/** Diagnostics never cancel or clear an unresolved native operation. */
export interface ManagementRpcState {
  pending?: { op: string; result: Promise<unknown>; id: string; startedAt: number };
}
export interface ManagementRpcObservation {
  phase: "started" | "completed" | "failed" | "wait_timeout" | "blocked";
  requestedOperation: string;
  pendingOperation: string;
  rpcId: string;
  elapsedMs: number;
  result?: boolean | string;
}
export async function callManagementRpc<T>(state: ManagementRpcState, op: string, action: () => Promise<T>, emit?: (event: ManagementRpcObservation) => void, waitMs = 1_000): Promise<T> {
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs >= 90_000) throw new RangeError("Management RPC wait must be an integer between 1 and 89999ms");
  const report = (phase: ManagementRpcObservation["phase"], pending: NonNullable<ManagementRpcState["pending"]>, result?: boolean | string) => {
    try { emit?.({phase, requestedOperation: op, pendingOperation: pending.op, rpcId: pending.id, elapsedMs: Date.now()-pending.startedAt, ...(result === undefined ? {} : {result})}); } catch { /* Observation cannot alter authority or RPC outcomes. */ }
  };
  if (state.pending && state.pending.op !== op) {
    report("blocked", state.pending);
    throw new Error("Previous management RPC outcome is pending");
  }
  if (!state.pending) {
    const pending = { op, result: Promise.resolve().then(action), id: crypto.randomUUID(), startedAt: Date.now() };
    state.pending = pending;
    report("started", pending);
    void pending.result.then(value => {
      // Only authority booleans and known process status words are diagnostic.
      report("completed", pending, typeof value === "boolean" ? value : typeof value === "string" && ["running","exited","killed","completed","error"].includes(value) ? value : undefined);
    }, () => report("failed", pending));
    void pending.result.finally(() => {
      if (state.pending === pending) state.pending = undefined;
    }).catch(() => {});
  }
  const pending = state.pending;
  const result = pending.result as Promise<T>;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([result, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { report("wait_timeout", pending); reject(new Error("Management RPC wait timed out; native outcome is unknown")); }, waitMs);
    })]);
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
