import type { Hono, Env } from "hono";

/** CF counterpart of the Node registration: copy routes and their scoped
 * middleware, while the existing /v1/* auth/rate/tenant middleware remains. */
export function registerMaishuApiAliases<E extends Env>(app: Hono<E>) {
  const prefix = "/v1/oma";
  for (const route of [...app.routes]) {
    if (route.path === prefix || route.path.startsWith(prefix + "/")) {
      app.on(route.method, "/v1/maishu" + route.path.slice(prefix.length), route.handler);
    }
  }
}
