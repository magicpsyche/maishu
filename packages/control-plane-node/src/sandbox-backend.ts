import type { SandboxFactoryEnv } from "@open-managed-agents/sandbox";

/** Operator-only infrastructure settings, independent of Session credentials. */
export interface SandboxBackendSettings {
  provider: "opensandbox";
  domain: string;
  protocol: "http" | "https";
  runtime: "docker";
  image: string;
  cpu: string;
  memory: string;
  timeoutSeconds: number;
  readyTimeoutMs: number;
}
export interface SandboxBackendView {
  revision: string;
  source: "environment" | "console";
  settings: SandboxBackendSettings;
  credentialSet: boolean;
}
export interface SandboxBackendUpdate {
  expectedRevision: string;
  settings: SandboxBackendSettings;
  /** Omitted means retain the current key. Empty means explicitly clear it. */
  apiKey?: string;
}
export interface SandboxBackendController {
  read(): Promise<SandboxBackendView>;
  save(input: SandboxBackendUpdate): Promise<SandboxBackendView>;
  importEnvironment?(expectedRevision: string): Promise<SandboxBackendView>;
  probe(input: SandboxBackendUpdate): Promise<{ ok: true; stages: string[] }>;
}

export function backendEnvironment(settings: SandboxBackendSettings, apiKey: string): SandboxFactoryEnv {
  return {
    SANDBOX_PROVIDER: "opensandbox", OPENSANDBOX_DOMAIN: settings.domain,
    OPENSANDBOX_PROTOCOL: settings.protocol, OPENSANDBOX_RUNTIME: settings.runtime,
    SANDBOX_IMAGE: settings.image, OPENSANDBOX_CPU: settings.cpu,
    OPENSANDBOX_MEMORY: settings.memory, OPENSANDBOX_TIMEOUT_SECONDS: String(settings.timeoutSeconds),
    OPENSANDBOX_READY_TIMEOUT_MS: String(settings.readyTimeoutMs), OPENSANDBOX_API_KEY: apiKey,
    // Prevent optional aliases from silently replacing an explicitly cleared key.
    OPEN_SANDBOX_API_KEY: apiKey,
    // This product's Work execution requires a trusted prestarted management plane.
    OPENSANDBOX_MANAGED_BOOTSTRAP: "1",
  };
}

export function validateBackendSettings(value: unknown): SandboxBackendSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("沙箱配置格式不正确");
  const s = value as Record<string, unknown>;
  if (s.provider !== "opensandbox" || s.runtime !== "docker") throw new Error("当前仅支持 OpenSandbox Docker 后端");
  if (s.protocol !== "http" && s.protocol !== "https") throw new Error("请选择 HTTP 或 HTTPS");
  if (typeof s.domain !== "string" || !s.domain.trim() || /[\s/@?#]/.test(s.domain)) throw new Error("地址应为主机名或 IP，可带端口，不包含协议和路径");
  try { const u = new URL(`${s.protocol}://${s.domain}`); if (u.username || u.password || u.pathname !== "/") throw new Error(); }
  catch { throw new Error("沙箱服务地址不正确"); }
  if (typeof s.image !== "string" || !s.image.trim() || /\s/.test(s.image) || s.image.length > 512) throw new Error("请填写有效的默认镜像");
  if (typeof s.cpu !== "string" || !/^(?:[1-9]\d*(?:\.\d+)?|0\.\d+|[1-9]\d*m)$/.test(s.cpu)) throw new Error("CPU 数量格式不正确");
  if (typeof s.memory !== "string" || !/^[1-9]\d*(?:Mi|Gi|M|G)$/.test(s.memory)) throw new Error("内存格式示例：1024Mi 或 2Gi");
  if (!Number.isInteger(s.timeoutSeconds) || Number(s.timeoutSeconds) < 60 || Number(s.timeoutSeconds) > 86400) throw new Error("沙箱有效期应为 60 至 86400 秒");
  if (!Number.isInteger(s.readyTimeoutMs) || Number(s.readyTimeoutMs) < 1000 || Number(s.readyTimeoutMs) > 600000) throw new Error("启动等待时间应为 1000 至 600000 毫秒");
  return { provider: "opensandbox", domain: s.domain, protocol: s.protocol, runtime: "docker", image: s.image,
    cpu: s.cpu, memory: s.memory, timeoutSeconds: Number(s.timeoutSeconds), readyTimeoutMs: Number(s.readyTimeoutMs) };
}
