import { randomUUID } from "node:crypto";
import type { KvStore } from "@open-managed-agents/kv-store";
import { listAll } from "@open-managed-agents/kv-store";
import { createPlatformSettingsStore } from "./platform-settings-store.js";
import type { NodeDatabase } from "@open-managed-agents/node-database";
import type { PurposeCipher, NodeSecrets } from "../secrets.js";
import type { HarnessCredentialController, HarnessCredentialInput, HarnessCredentialView } from "../harness-credentials.js";
import { CODEX_REFRESH_INTERVAL_MS, codexAuth, refreshedCodexAuth, type CodexRefreshInput } from "./codex-auth-refresh.js";

interface Stored extends HarnessCredentialView { content: string }
const FILES = { codex: "auth.json", claude: ".credentials.json", dsh: ".credentials.yaml" } as const;
const IDENTITIES = { codex: "codex-acp", claude: "claude-acp", dsh: "dsh-acp" } as const;
const prefix = (workspace: string) => `harness-credential:${encodeURIComponent(workspace)}:`;
const sessionPrefix = (workspace: string, id: string) => `harness-session-credential:${encodeURIComponent(workspace)}:${id}:`;
function key(workspace: string, id: string) {
  if (!/^hc_[a-f0-9-]{36}$/.test(id)) throw new Error("凭证引用无效");
  return `${prefix(workspace)}${id}`;
}
function view({ content: _content, ...rest }: Stored): HarnessCredentialView { return rest; }
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Write-only account authentication, scoped to a workspace and authorized agents.
 * This is deliberately separate from outbound-proxy Vault credentials. */
export class EncryptedHarnessCredentials implements HarnessCredentialController {
  constructor(private readonly kv: KvStore & Required<Pick<KvStore, "compareAndSwap">>, private readonly cipher: PurposeCipher) {}
  private async load(workspaceId: string, id: string) {
    const sealed = await this.kv.get(key(workspaceId, id));
    if (sealed === null) throw new Error("凭证不存在或不可访问");
    return { sealed, record: JSON.parse(await this.cipher.decrypt(sealed)) as Stored };
  }
  async list(workspaceId: string) {
    const result: HarnessCredentialView[] = [];
    for (const item of await listAll(this.kv, prefix(workspaceId))) {
      const sealed = await this.kv.get(item.name);
      if (sealed !== null) result.push(view(JSON.parse(await this.cipher.decrypt(sealed)) as Stored));
    }
    return result;
  }
  async save(workspaceId: string, input: HarnessCredentialInput, id?: string) {
    if (!input || typeof input !== "object" || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120 || !Object.hasOwn(FILES, input.kind)) throw new Error("凭证名称或引擎类型不正确");
    if (input.allowWorkspace !== undefined && typeof input.allowWorkspace !== "boolean") throw new Error("工作区授权格式不正确");
    const allowed = input.allowedAgentIds ?? [];
    if (!Array.isArray(allowed) || allowed.length > 200 || allowed.some(v => typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v))) throw new Error("授权智能体列表不正确");
    const previous = id ? await this.load(workspaceId, id) : null;
    if (previous && input.expectedRevision !== previous.record.revision) throw new Error("凭证已更新，请刷新后重试");
    if (previous && previous.record.kind !== input.kind) throw new Error("不能修改已有凭证的执行引擎类型");
    const content = input.content ?? previous?.record.content;
    if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > 262144) throw new Error("认证内容不能为空且不能超过 256 KiB");
    if (input.kind !== "dsh") {
      try { const parsed = JSON.parse(content); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); }
      catch { throw new Error("认证内容必须是有效的 JSON 对象"); }
    } else if (!/^\s*DEEPSEEK_API_KEY\s*:/m.test(content)) throw new Error("DeepSeek 凭证需包含 DEEPSEEK_API_KEY");
    const record: Stored = { id: id ?? `hc_${randomUUID()}`, name: input.name.trim(), kind: input.kind,
      revision: randomUUID(), allowedAgentIds: [...new Set(allowed)], allowWorkspace: input.allowWorkspace === true,
      updatedAt: new Date().toISOString(), content,
      ...(previous?.record.content === content && previous.record.codexRefresh ? { codexRefresh: previous.record.codexRefresh } : {}) };
    if (!await this.kv.compareAndSwap(key(workspaceId, record.id), previous?.sealed ?? null, await this.cipher.encrypt(JSON.stringify(record)))) throw new Error("凭证已更新，请刷新后重试");
    return view(record);
  }
  /** Operator-only in-process maintenance. No secret export or refresh HTTP route.
   * Existing Session pins are never changed by this operation. */
  async refreshCodexDue(refresh: (input: CodexRefreshInput) => Promise<string>, options: { now?: number; force?: boolean } = {}) {
    const now = options.now ?? Date.now(), at = new Date(now).toISOString();
    const results: Array<{ workspaceId: string; id: string; status: "refreshed" | "not_due" | "failed" | "superseded" | "skipped" }> = [];
    for (const item of await listAll(this.kv, "harness-credential:")) {
      const parts = item.name.split(":");
      if (parts.length !== 3) continue;
      const workspaceId = decodeURIComponent(parts[1]!), id = parts[2]!;
      const original = await this.load(workspaceId, id);
      const auth = codexAuth(original.record.content);
      const result = (status: typeof results[number]["status"]) => { results.push({ workspaceId, id, status }); };
      if (original.record.kind !== "codex" || !auth) { result("skipped"); continue; }
      // A failed refresh needs operator attention; do not repeatedly spend a
      // potentially consumed refresh token. A new upload or --force retries it.
      if (original.record.codexRefresh?.status === "failed" && !options.force) { result("failed"); continue; }
      const baseline = Date.parse(original.record.codexRefresh?.lastSuccessAt ?? auth.last_refresh ?? original.record.updatedAt);
      if (!options.force && Number.isFinite(baseline) && baseline <= now && now - baseline < CODEX_REFRESH_INTERVAL_MS) { result("not_due"); continue; }
      let content: string | undefined;
      try {
        content = await refresh({ workspaceId, id, content: original.record.content });
        if (!refreshedCodexAuth(original.record.content, content)) throw new Error("刷新后的账户认证不匹配");
      } catch { content = undefined; }
      let committed = false;
      // Preserve a concurrent rename/grant change, but never overwrite a new
      // login, recreate a deleted credential, or alter any Session pin.
      for (let attempt = 0; attempt < 8; attempt++) {
        const sealed = await this.kv.get(key(workspaceId, id));
        if (sealed === null) break;
        const current = JSON.parse(await this.cipher.decrypt(sealed)) as Stored;
        if (current.content !== original.record.content || current.kind !== "codex") break;
        const next: Stored = { ...current, revision: randomUUID(), updatedAt: at,
          ...(content === undefined ? {} : { content }),
          codexRefresh: { status: content === undefined ? "failed" : "ok", lastAttemptAt: at,
            ...(content === undefined ? current.codexRefresh?.lastSuccessAt ? { lastSuccessAt: current.codexRefresh.lastSuccessAt } : {}
              : { lastSuccessAt: at, nextDueAt: new Date(now + CODEX_REFRESH_INTERVAL_MS).toISOString() }) } };
        if (await this.kv.compareAndSwap(key(workspaceId, id), sealed, await this.cipher.encrypt(JSON.stringify(next)))) { committed = true; break; }
      }
      result(committed ? content === undefined ? "failed" : "refreshed" : "superseded");
    }
    return results;
  }
  async remove(workspaceId: string, id: string) {
    const current = await this.load(workspaceId, id);
    if (!await this.kv.compareAndSwap(key(workspaceId, id), current.sealed, null)) throw new Error("凭证已更新，请刷新后重试");
    for (const item of await listAll(this.kv, sessionPrefix(workspaceId, id))) await this.kv.delete(item.name);
  }
  async materialize(input: Parameters<HarnessCredentialController["materialize"]>[0]) {
    const config = input.agentConfig as { harness?: string; acp?: { agent?: { id?: string; command?: string; args?: string[]; env?: Record<string, string> } } } | undefined;
    const agent = config?.acp?.agent;
    const env = agent?.env;
    if (!env?.MAISHU_CREDENTIAL_REF || env.MAISHU_AUTH_MODE !== "native") return;
    if (config?.harness !== "acp-sandbox" || agent?.command !== "/usr/local/bin/maishu-harness") throw new Error("原生账户凭证仅可绑定麦枢受控执行入口");
    const current = await this.load(input.workspaceId, env.MAISHU_CREDENTIAL_REF);
    if (!current.record.allowWorkspace && !current.record.allowedAgentIds.includes(input.agentId)) throw new Error("该智能体未获准使用此账户凭证");
    if (agent.id !== IDENTITIES[current.record.kind] || agent.args?.[0] !== current.record.kind) throw new Error("账户凭证与执行引擎不匹配");
    // Freeze identity/config bytes per Session. Rotation affects new Sessions,
    // while revocation and authorization above are checked on every execution.
    const bindingKey = sessionPrefix(input.workspaceId, current.record.id) + encodeURIComponent(input.sessionId);
    let pinned = await this.kv.get(bindingKey);
    if (pinned === null) {
      await this.kv.compareAndSwap(bindingKey, null, current.sealed);
      pinned = await this.kv.get(bindingKey);
    }
    if (pinned === null) throw new Error("会话账户绑定失败");
    const record = JSON.parse(await this.cipher.decrypt(pinned)) as Stored;
    if (record.id !== current.record.id || record.kind !== current.record.kind) throw new Error("会话账户绑定不一致");
    if (!input.sandbox.writeFileBytes) throw new Error("沙箱不支持认证文件注入");
    const temporary = `/tmp/maishu-inject-${randomUUID()}`;
    const target = `/run/maishu-credentials/${record.id}/${FILES[record.kind]}`;
    // The payload travels through the binary upload port, never shell argv,
    // Session Files, messages, Memory Stores or the canonical event log.
    await input.sandbox.writeFileBytes(temporary, new TextEncoder().encode(record.content));
    const code = `import os,pathlib,stat,sys
source=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2]); root=pathlib.Path('/run/maishu-credentials')
try:
 if root.is_symlink() or target.parent.is_symlink(): raise ValueError('invalid authentication directory')
 target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 if target.parent.resolve()!=target.parent: raise ValueError('invalid authentication directory')
 os.chmod(root,0o700); os.chmod(target.parent,0o700)
 fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as stream:
  if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode): raise ValueError('invalid authentication input')
  content=stream.read(262145)
 if len(content)>262144: raise ValueError('authentication input too large')
 os.chmod(source,0o600); os.replace(source,target); os.chmod(target,0o600)
finally:
 source.unlink(missing_ok=True)
`;
    try { await input.sandbox.exec(`python3 -c ${quote(code)} ${quote(temporary)} ${quote(target)}`); }
    catch {
      await input.sandbox.exec(`rm -f -- ${quote(temporary)}`).catch(() => undefined);
      throw new Error("认证文件注入失败，请检查执行环境");
    }
  }
}

export function createHarnessCredentials(database: NodeDatabase, secrets: NodeSecrets) {
  return new EncryptedHarnessCredentials(createPlatformSettingsStore(database, "__platform_harness_credentials__"), secrets.cipherFor("platform.harness.credentials"));
}
