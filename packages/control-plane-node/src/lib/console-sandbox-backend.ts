import { randomUUID } from "node:crypto";
import type { KvStore } from "@open-managed-agents/kv-store";
import type { PurposeCipher } from "../secrets.js";
import { createPlatformSettingsStore } from "./platform-settings-store.js";
import type { NodeDatabase } from "@open-managed-agents/node-database";
import { generateSandboxToken, sandboxTokenSha256 } from "@open-managed-agents/sandbox-gateway";
import type { E2BManagedLocator } from "@open-managed-agents/sandbox-port-kit/managed-bootstrap";
import type { SandboxManagedProcessHandle, SandboxManagedProcessSpec, SandboxRuntimeHandle } from "@open-managed-agents/sandbox";
import { backendEnvironment, validateBackendSettings, type SandboxBackendController, type SandboxBackendUpdate, type SandboxBackendView } from "../sandbox-backend.js";
import { supportsDuplexProcess, type SandboxFactory, type SandboxFactoryContext, type SandboxFactoryEnv, type SandboxPort, type SandboxProviderPort, type SandboxRuntimePort } from "@open-managed-agents/sandbox";

type Runtime = SandboxPort & SandboxRuntimePort;
interface Revision { id: string; source: "environment" | "console"; environment: SandboxFactoryEnv }
const CURRENT = "sandbox-backend:current";
const LEGACY = "sandbox-backend:revision:environment";
const revisionKey = (id: string) => `sandbox-backend:revision:${id}`;
const backendKey = (key: string) => key.startsWith("OPENSANDBOX_") || key === "OPEN_SANDBOX_API_KEY" || key === "SANDBOX_IMAGE" || key === "SANDBOX_PROVIDER";

/** Immutable encrypted revisions and CAS Session bindings use the existing portable KV port. */
export class ConsoleSandboxBackend implements SandboxBackendController {
  constructor(private readonly kv: KvStore & Required<Pick<KvStore, "compareAndSwap">>, private readonly cipher: PurposeCipher,
    private readonly initialEnvironment: SandboxFactoryEnv, private readonly underlying: SandboxProviderPort<Runtime>,
    private readonly readOnlyConnect?: (handle: SandboxRuntimeHandle, context: SandboxFactoryContext, env: SandboxFactoryEnv) => Promise<Runtime | "gone">) {}

  private async legacy(): Promise<Revision> {
    let sealed = await this.kv.get(LEGACY);
    if (sealed === null) {
      const env = Object.fromEntries(Object.entries(this.initialEnvironment).filter(([key]) => backendKey(key)));
      const candidate = await this.cipher.encrypt(JSON.stringify({ id: "environment", source: "environment", environment: env }));
      await this.kv.compareAndSwap(LEGACY, null, candidate);
      sealed = await this.kv.get(LEGACY);
    }
    if (sealed === null) throw new Error("沙箱初始配置保存失败");
    return JSON.parse(await this.cipher.decrypt(sealed));
  }
  private async revision(id?: string): Promise<Revision> {
    const legacy = await this.legacy();
    const selected = id ?? await this.kv.get(CURRENT) ?? "environment";
    if (selected === "environment") return legacy;
    const sealed = await this.kv.get(revisionKey(selected));
    if (sealed === null) throw new Error("沙箱配置版本不存在，已停止分配以避免连接错误后端");
    return JSON.parse(await this.cipher.decrypt(sealed));
  }
  private view(r: Revision): SandboxBackendView {
    const e = r.environment;
    return { revision: r.id, source: r.source, credentialSet: !!(e.OPENSANDBOX_API_KEY || e.OPEN_SANDBOX_API_KEY), settings: {
      provider: "opensandbox", domain: e.OPENSANDBOX_DOMAIN ?? "localhost:8080", protocol: e.OPENSANDBOX_PROTOCOL === "https" ? "https" : "http",
      runtime: "docker", image: e.SANDBOX_IMAGE ?? "node:22-slim", cpu: e.OPENSANDBOX_CPU ?? "1", memory: e.OPENSANDBOX_MEMORY ?? "1Gi",
      timeoutSeconds: Number(e.OPENSANDBOX_TIMEOUT_SECONDS ?? 1800), readyTimeoutMs: Number(e.OPENSANDBOX_READY_TIMEOUT_MS ?? 120000),
    } };
  }
  async read() { return this.view(await this.revision()); }
  private async draft(input: SandboxBackendUpdate) {
    const current = await this.revision();
    if (typeof input.expectedRevision !== "string" || current.id !== input.expectedRevision) throw new Error("配置已更新，请刷新页面后重试");
    if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || input.apiKey.length > 65536)) throw new Error("认证密钥格式不正确");
    const settings = validateBackendSettings(input.settings);
    return { current, environment: { ...current.environment, ...backendEnvironment(settings, input.apiKey ?? current.environment.OPENSANDBOX_API_KEY ?? current.environment.OPEN_SANDBOX_API_KEY ?? "") } };
  }
  async save(input: SandboxBackendUpdate) {
    const { current, environment } = await this.draft(input);
    const next: Revision = { id: randomUUID(), source: "console", environment };
    await this.kv.put(revisionKey(next.id), await this.cipher.encrypt(JSON.stringify(next)));
    const expected = current.id === "environment" ? null : current.id;
    if (!await this.kv.compareAndSwap(CURRENT, expected, next.id)) throw new Error("配置已更新，请刷新页面后重试");
    return this.view(next);
  }
  async importEnvironment(expectedRevision: string) {
    const current = await this.revision();
    if (current.id !== expectedRevision) throw new Error("配置已更新，请刷新页面后重试");
    const environment = Object.fromEntries(Object.entries(this.initialEnvironment).filter(([key]) => backendKey(key)));
    if (environment.OPENSANDBOX_RUNTIME !== "docker") throw new Error("部署配置需选择 OpenSandbox Docker 后端");
    environment.OPENSANDBOX_MANAGED_BOOTSTRAP = "1";
    const next: Revision = { id: randomUUID(), source: "environment", environment };
    validateBackendSettings(this.view(next).settings);
    await this.kv.put(revisionKey(next.id), await this.cipher.encrypt(JSON.stringify(next)));
    if (!await this.kv.compareAndSwap(CURRENT, current.id === "environment" ? null : current.id, next.id)) throw new Error("配置已更新，请刷新页面后重试");
    return this.view(next);
  }
  /** Existing unbound handles always use the frozen startup revision. New allocations bind before create. */
  async environmentFor(ctx: SandboxFactoryContext, restore: boolean, base: SandboxFactoryEnv): Promise<SandboxFactoryEnv> {
    const key = `sandbox-backend:session:${encodeURIComponent(ctx.workspaceId ?? "default")}:${encodeURIComponent(ctx.sessionId)}`;
    let id = await this.kv.get(key);
    if (id === null) {
      const selected = restore ? "environment" : (await this.revision()).id;
      await this.kv.compareAndSwap(key, null, selected);
      id = await this.kv.get(key);
    }
    if (id === null) throw new Error("会话沙箱后端绑定失败");
    // Absence is pinned too: newly added provider env/volumes must not leak
    // into an old Session just because they were absent in its revision.
    return { ...Object.fromEntries(Object.entries(base).filter(([key]) => !backendKey(key))), ...(await this.revision(id)).environment };
  }
  provider(): SandboxProviderPort<Runtime> {
    return {
      create: async (ctx, env) => this.underlying.create(ctx, await this.environmentFor(ctx, false, env)),
      resume: async (handle, ctx, env) => this.underlying.resume(handle, ctx, await this.environmentFor(ctx, true, env)),
      restore: async (checkpoint, ctx, env) => this.underlying.restore(checkpoint, ctx, await this.environmentFor(ctx, true, env)),
    };
  }
  factory(): SandboxFactory {
    return Object.assign(async (ctx: SandboxFactoryContext, env: SandboxFactoryEnv) => this.provider().create(ctx, env), { capabilities: { allocationIsolation: true } });
  }
  async connectWorkReadonly(handle: SandboxRuntimeHandle, context: SandboxFactoryContext, env: SandboxFactoryEnv) {
    if (!this.readOnlyConnect) throw new Error("Trusted readonly sandbox attachment is not configured");
    return this.readOnlyConnect(handle, context, await this.environmentFor(context, true, env));
  }
  async probe(input: SandboxBackendUpdate): Promise<{ ok: true; stages: string[] }> {
    const { environment } = await this.draft(input);
    const probeSession = `backend-probe-${randomUUID()}`;
    const sandbox = await this.underlying.create({ sessionId: probeSession, workspaceId: "__platform__", workdir: "/workspace" }, { ...this.initialEnvironment, ...environment });
    const stages = ["沙箱服务连接与创建"];
    let failure: unknown;
    try {
      const marker = randomUUID();
      await sandbox.writeFile("/tmp/maishu-backend-probe.txt", marker);
      if (await sandbox.readFile("/tmp/maishu-backend-probe.txt") !== marker) throw new Error();
      stages.push("文件读写");
      if ((await sandbox.exec("printf maishu-probe" )).trim() !== "maishu-probe") throw new Error();
      stages.push("命令执行");
      if (!supportsDuplexProcess(sandbox)) throw new Error();
      const process = await sandbox.spawnDuplexProcess({ command: "node", args: ["-e", "process.stdin.once('data',d=>{process.stdout.write(d,()=>process.exit(0))})"] });
      try {
        const writer = process.stdin.getWriter();
        const reader = process.stdout.getReader();
        let observed = "";
        const transfer = (async () => { while (observed.length < marker.length) { const chunk = await reader.read(); if (chunk.done) break; observed += new TextDecoder().decode(chunk.value); } })();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([Promise.all([writer.write(new TextEncoder().encode(marker)), transfer]), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("duplex timeout")), 15000); })]); }
        finally { if (timer) clearTimeout(timer); writer.releaseLock(); await reader.cancel().catch(() => undefined); }
        if (observed !== marker) throw new Error();
      } finally { await process.kill().catch(() => undefined); }
      stages.push("ACP 双向进程实际收发");
      const managed = sandbox as Runtime & {
        managementBootstrapEnabled?(): boolean;
        startManagedProcess?(spec: SandboxManagedProcessSpec, identity: E2BManagedLocator["identity"]): Promise<SandboxManagedProcessHandle>;
        inspectManagedProcessSlot?(): Promise<E2BManagedLocator>;
        restoreManagedProcess?(locator: E2BManagedLocator): Promise<SandboxManagedProcessHandle>;
      };
      if (managed.managementBootstrapEnabled?.() === false || !managed.startManagedProcess || !managed.inspectManagedProcessSlot || !managed.restoreManagedProcess) {
        throw Object.assign(new Error("可信管理入口未启用"), { code: "management_unavailable" });
      }
      const token = generateSandboxToken();
      const identity = { workspaceId: "__platform__", sessionId: probeSession, workId: "probe", attemptId: "probe:1" };
      const handle = await managed.startManagedProcess({ command: "/usr/local/bin/node", args: ["-e", "setInterval(()=>{},1000)"], env: { OPENMA_SANDBOX_TOKEN: token } }, identity);
      try {
        if (await handle.getStatus() !== "running") throw new Error();
        const locator = await managed.inspectManagedProcessSlot();
        if (locator.id !== handle.id || locator.pid !== handle.pid || locator.holderHash !== await sandboxTokenSha256(token)
          || JSON.stringify(locator.identity) !== JSON.stringify(identity)) throw new Error();
        const restored = await managed.restoreManagedProcess(locator);
        await restored.kill("SIGTERM");
        if (await restored.getStatus() !== "exited") throw new Error();
      } finally { await handle.kill("SIGKILL").catch(() => undefined); }
      stages.push("安全管理进程启动、身份绑定、恢复与停止");
    } catch (error) { failure = error; }
    try { if (!sandbox.destroy) throw new Error(); await sandbox.destroy(); stages.push("临时沙箱销毁"); }
    catch { throw new Error("临时沙箱清理失败，请管理员检查执行端"); }
    if ((failure as { code?: string } | undefined)?.code === "management_unavailable") throw failure;
    if (failure) throw new Error("沙箱执行探针失败，请检查可信管理入口、镜像与执行端点可达性");
    return { ok: true, stages };
  }
}

export function createConsoleSandboxBackend(database: NodeDatabase, cipher: PurposeCipher, environment: SandboxFactoryEnv, provider: SandboxProviderPort<Runtime>,
  readonlyConnect?: (handle: SandboxRuntimeHandle, context: SandboxFactoryContext, env: SandboxFactoryEnv) => Promise<Runtime | "gone">) {
  return new ConsoleSandboxBackend(createPlatformSettingsStore(database, "__platform_sandbox__"), cipher, environment, provider, readonlyConnect);
}
