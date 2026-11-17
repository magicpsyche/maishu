// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { http, HttpResponse, type HttpHandler } from "msw";

// MSW handlers shared across the whole test suite. Tests opt in to
// specific responses with `server.use(http.get(...))` rather than
// relying on a big global registry, so this list stays small — only
// add a handler here when many tests would otherwise duplicate it.
export const handlers: HttpHandler[] = [
  http.get("/v1/maishu/capabilities", () => HttpResponse.json({ runtime_bridge: true, remote_sandbox: true })),
  // Agent dialogs verify the deployment catalog before saving. Individual tests override it.
  http.get("/v1/maishu/harnesses", () => HttpResponse.json({
    object: "list",
    default_harness_id: "test-host",
    data: [{ id: "test-host", label: "Test harness", description: "Test deployment",
      execution: { placement: "host" }, capabilities: { runtime_binding: false }, requirements: [] }],
  })),
];
