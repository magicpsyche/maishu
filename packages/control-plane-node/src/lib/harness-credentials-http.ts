import { Hono } from "hono";
import type { HarnessCredentialController, HarnessCredentialInput } from "../harness-credentials.js";

export function harnessCredentialRoutes(options: { controller?: HarnessCredentialController; administratorIds: string[]; deploymentKey?: string }) {
  const app = new Hono<{ Variables: { user_id?: string; tenant_id: string } }>();
  app.use("*", async (c, next) => {
    const uid = c.get("user_id");
    if (!(uid && options.administratorIds.includes(uid)) && !(options.deploymentKey && c.req.header("x-api-key") === options.deploymentKey)) return c.json({ error: "仅实例管理员可管理执行账户凭证" }, 403);
    c.header("Cache-Control", "no-store");
    if (!options.controller) return c.json({ error: "当前部署未启用加密账户凭证，请配置加密根密钥" }, 503);
    await next();
  });
  app.get("/", async (c) => {
    try { return c.json({ data: await options.controller!.list(c.get("tenant_id")) }); }
    catch { return c.json({ error: "读取账户凭证列表失败" }, 503); }
  });
  const parse = async (request: Request) => {
    const text = await request.text();
    if (Buffer.byteLength(text) > 300000) throw new Error();
    return JSON.parse(text) as HarnessCredentialInput;
  };
  app.post("/", async (c) => {
    try { return c.json(await options.controller!.save(c.get("tenant_id"), await parse(c.req.raw)), 201); }
    catch { return c.json({ error: "保存失败，请检查认证格式、引擎和授权范围" }, 400); }
  });
  app.put("/:id", async (c) => {
    try { return c.json(await options.controller!.save(c.get("tenant_id"), await parse(c.req.raw), c.req.param("id"))); }
    catch { return c.json({ error: "更新失败，请检查配置或刷新后重试" }, 400); }
  });
  app.delete("/:id", async (c) => {
    try { await options.controller!.remove(c.get("tenant_id"), c.req.param("id")); return c.json({ deleted: true }); }
    catch { return c.json({ error: "删除失败，请刷新后重试" }, 400); }
  });
  return app;
}
