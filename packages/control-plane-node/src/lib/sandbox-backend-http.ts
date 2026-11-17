import { Hono } from "hono";
import type { SandboxBackendController, SandboxBackendUpdate } from "../sandbox-backend.js";

export function sandboxBackendRoutes(options: {
  controller?: SandboxBackendController;
  administratorIds: string[];
  deploymentKey?: string;
}) {
  const app = new Hono<{ Variables: { user_id?: string } }>();
  app.use("*", async (c, next) => {
    const uid = c.get("user_id");
    const key = c.req.header("x-api-key");
    if (!(uid && options.administratorIds.includes(uid)) && !(options.deploymentKey && key === options.deploymentKey)) {
      return c.json({ error: "仅实例管理员可管理沙箱后端" }, 403);
    }
    c.header("Cache-Control", "no-store");
    if (!options.controller) return c.json({ error: "当前部署尚未启用 OpenSandbox 后端管理，请配置加密根密钥和 OpenSandbox 适配器" }, 503);
    await next();
  });
  app.get("/", async (c) => {
    try { return c.json(await options.controller!.read()); }
    catch { return c.json({ error: "读取沙箱后端配置失败" }, 503); }
  });
  const parse = async (request: Request): Promise<SandboxBackendUpdate> => {
    const text = await request.text();
    if (text.length > 80000) throw new Error("配置内容过大");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置格式不正确");
    return value as SandboxBackendUpdate;
  };
  app.put("/", async (c) => {
    try { return c.json(await options.controller!.save(await parse(c.req.raw))); }
    catch (e) { return c.json({ error: e instanceof SyntaxError ? "配置格式不正确" : e instanceof Error ? e.message : "保存失败" }, 400); }
  });
  app.post("/import-environment", async (c) => {
    if (!options.controller?.importEnvironment) return c.json({ error: "当前部署不支持导入部署配置" }, 409);
    try {
      const input = await parse(c.req.raw);
      return c.json(await options.controller.importEnvironment(input.expectedRevision));
    } catch { return c.json({ error: "导入失败，请检查部署配置版本并刷新重试" }, 400); }
  });
  app.post("/probe", async (c) => {
    let input: SandboxBackendUpdate;
    try { input = await parse(c.req.raw); }
    catch { return c.json({ error: "配置格式不正确" }, 400); }
    try { return c.json(await options.controller!.probe(input)); }
    // Provider exceptions can contain endpoints and headers. Never return them.
    catch (error) {
      if ((error as { code?: string })?.code === "management_unavailable") return c.json({ error: "可信管理入口未启用：执行镜像需预装管理启动器，并启用 OPENSANDBOX_MANAGED_BOOTSTRAP=1" }, 400);
      return c.json({ error: "探测未通过，请检查地址、密钥、镜像、安全管理入口及执行端口；清理失败时请管理员检查执行端" }, 400);
    }
  });
  return app;
}
