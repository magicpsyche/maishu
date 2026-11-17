import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { registerMaishuApiAliases } from "../../../packages/control-plane-node/src/lib/maishu-api-aliases.js";
import { registerMaishuApiAliases as registerCfAliases } from "../../main/src/lib/maishu-api-aliases.js";

describe("branded extension API aliases", () => {
  function app() {
    const routes = new Hono();
    routes.use("*", async (c, next) => {
      if (c.req.header("x-api-key") !== "synthetic") return c.json({ error: "unauthorized" }, 401);
      await next();
    });
    const admin = new Hono();
    admin.use("*", async (c, next) => {
      if (c.req.header("x-admin") !== "yes") return c.json({ error: "forbidden" }, 403);
      await next();
    });
    admin.get("/:id", c => c.json({ id: c.req.param("id"), actualPath: c.req.path }));
    routes.route("/oma/admin", admin);
    routes.get("/official", c => c.json({ official: true }));
    registerMaishuApiAliases(routes);
    return new Hono().route("/v1", routes);
  }
  it("keeps authentication and nested administrator checks on both paths", async () => {
    const server = app();
    for (const prefix of ["oma", "maishu"]) {
      expect((await server.request(`/v1/${prefix}/admin/a`)).status).toBe(401);
      expect((await server.request(`/v1/${prefix}/admin/a`, { headers: { "x-api-key": "synthetic" } })).status).toBe(403);
      const response = await server.request(`/v1/${prefix}/admin/a`, { headers: { "x-api-key": "synthetic", "x-admin": "yes" } });
      expect(await response.json()).toEqual({ id: "a", actualPath: `/v1/${prefix}/admin/a` });
    }
  });
  it("does not alias unrelated official routes", async () => {
    expect((await app().request("/v1/maishu/official", { headers: { "x-api-key": "synthetic" } })).status).toBe(404);
  });
  it("CF aliases preserve the global /v1 authentication and route middleware", async () => {
    const server = new Hono();
    server.use("/v1/*", async (c, next) => { if (c.req.header("x-api-key") !== "synthetic") return c.json({ error: "unauthorized" }, 401); await next(); });
    server.use("/v1/oma/admin/*", async (c, next) => { if (c.req.header("x-admin") !== "yes") return c.json({ error: "forbidden" }, 403); await next(); });
    server.get("/v1/oma/admin/:id", c => c.json({ id: c.req.param("id") }));
    registerCfAliases(server);
    expect((await server.request("/v1/maishu/admin/a")).status).toBe(401);
    expect((await server.request("/v1/maishu/admin/a", { headers: { "x-api-key": "synthetic" } })).status).toBe(403);
    const result = await server.request("/v1/maishu/admin/a", { headers: { "x-api-key": "synthetic", "x-admin": "yes" } });
    expect(await result.json()).toEqual({ id: "a" });
  });
});
