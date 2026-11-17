import type { NodeEnvironment } from "../config.js";

/** Explicit operator allowlist for the remote management/ACP process.
 * Never copy the host environment or a sandbox's arbitrary env wholesale. */
export function executionProxyEnvironment(environment: NodeEnvironment, origin?: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] as const) {
    const value = environment[`MAISHU_EXECUTION_${name}`];
    if (!value) continue;
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("执行端代理地址格式不正确"); }
    if (!["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol) || url.username || url.password || /[\r\n\0]/.test(value)) throw new Error("执行端代理应为无内联认证的 HTTP 或 SOCKS 地址");
    result[name] = value;
    result[name.toLowerCase()] = value;
  }
  const configured = environment.MAISHU_EXECUTION_NO_PROXY ?? "";
  if (configured.length > 8192 || /[\r\n\0]/.test(configured)) throw new Error("执行端代理例外配置不正确");
  const bypass = new Set(configured.split(",").map(v => v.trim()).filter(Boolean));
  for (const name of ["localhost", "127.0.0.1", "::1"]) bypass.add(name);
  if (origin) bypass.add(new URL(origin).hostname);
  if (Object.keys(result).length || configured) {
    result.NO_PROXY = [...bypass].join(",");
    result.no_proxy = result.NO_PROXY;
  }
  return result;
}
