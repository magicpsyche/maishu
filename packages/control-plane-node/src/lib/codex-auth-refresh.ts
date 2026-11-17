// 麦枢：仅在受信控制端维护 Codex 认证，不运行模型或任务。
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export const CODEX_REFRESH_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;
export type CodexAuth = { auth_mode: "chatgpt"; last_refresh?: string; tokens: { access_token: string; refresh_token: string; account_id: string } };
export function codexAuth(content: string): CodexAuth | null {
  try {
    const v = JSON.parse(content);
    return v?.auth_mode === "chatgpt" && [v.tokens?.access_token, v.tokens?.refresh_token, v.tokens?.account_id]
      .every(x => typeof x === "string" && x.length > 0) ? v : null;
  } catch { return null; }
}
export function refreshedCodexAuth(before: string, after: string): boolean {
  if (Buffer.byteLength(after) > 262144) return false;
  const a = codexAuth(before), b = codexAuth(after);
  return !!a && !!b && a.tokens.account_id === b.tokens.account_id
    && (a.tokens.access_token !== b.tokens.access_token || a.tokens.refresh_token !== b.tokens.refresh_token
      || Date.parse(b.last_refresh ?? "") > Date.parse(a.last_refresh ?? ""));
}
export type CodexRefreshInput = { workspaceId: string; id: string; content: string };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("不安全的认证维护目录");
  await chmod(path, 0o700);
}
async function atomicPrivate(path: string, bytes: string) {
  const temp = path + "." + randomUUID();
  await writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}
async function authFile(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 262144) throw new Error("认证维护文件不正确");
    return await file.readFile("utf8");
  } finally { await file.close(); }
}

/** The caller serializes maintenance with flock. A private durable home keeps
 * a completed rotation available after process loss or a failed database CAS. */
export function createCodexAuthRefresher(options: { binary: string; directory: string; timeoutMs?: number }) {
  if (!options.binary.startsWith("/") || !options.directory.startsWith("/")) throw new Error("认证维护路径必须为绝对路径");
  return async (input: CodexRefreshInput): Promise<string> => {
    if (!codexAuth(input.content)) throw new Error("不是可刷新的 Codex 登录认证");
    await privateDirectory(options.directory);
    const home = join(options.directory, hash(input.workspaceId + ":" + input.id));
    await privateDirectory(home);
    const auth = join(home, "auth.json"), journal = join(home, "refresh-source.json");
    let source: { sourceHash?: string } = {};
    try { source = JSON.parse(await readFile(journal, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("认证维护记录不正确"); }
    let existing: string | null = null;
    try { existing = await authFile(auth); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    // Finish a prior write-back first; never spend the same old refresh token again.
    if (source.sourceHash === hash(input.content) && existing !== null && refreshedCodexAuth(input.content, existing)) return existing;
    await atomicPrivate(auth, input.content);
    await atomicPrivate(journal, JSON.stringify({ sourceHash: hash(input.content) }));
    await atomicPrivate(join(home, "config.toml"), 'cli_auth_credentials_store = "file"\n');
    let success = false;
    try { await refreshRpc(options.binary, home, options.timeoutMs ?? 90_000); success = true; }
    catch { /* A reply can be lost after Codex persisted the rotated file. */ }
    const candidate = await authFile(auth);
    if (!refreshedCodexAuth(input.content, candidate)) throw new Error(success ? "Codex 未写入更新后的认证" : "Codex 认证刷新失败，请检查网络或重新授权");
    return candidate;
  };
}

/** Bounded JSONL RPC. Errors and stderr never include credential bytes in logs. */
async function refreshRpc(binary: string, home: string, timeoutMs: number): Promise<void> {
  const child = spawn(binary, ["app-server"], {
    env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  let counter = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();
  const fail = () => { for (const p of pending.values()) p.reject(new Error("Codex 认证维护通信失败")); pending.clear(); };
  const closed = new Promise<void>(resolve => child.once("close", () => { fail(); resolve(); }));
  child.on("error", fail); child.on("exit", fail);
  lines.on("line", line => {
    if (line.length > 1048576) { fail(); return; }
    try {
      const message = JSON.parse(line), p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id);
      if (message.error) p.reject(new Error("Codex 拒绝认证维护请求")); else p.resolve(message.result);
    } catch { fail(); }
  });
  const timer = setTimeout(() => { fail(); child.kill("SIGKILL"); }, timeoutMs);
  const request = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => {
    const id = ++counter; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", error => { if (error) fail(); });
  });
  try {
    await request("initialize", { clientInfo: { name: "maishu_auth_refresh", version: "0.1.0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
    const account = await request("account/read", { refreshToken: true }) as { account?: { type?: string } };
    if (account?.account?.type !== "chatgpt") throw new Error("认证维护未返回 Codex 登录账号");
  } finally {
    clearTimeout(timer); lines.close(); child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const kill = setTimeout(() => { child.kill("SIGKILL"); }, 1000);
    await closed;
    clearTimeout(kill);
  }
}
