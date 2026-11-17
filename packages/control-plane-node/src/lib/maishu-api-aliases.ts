import type { Hono, Env } from "hono";

/** Register the same handlers in the same order, including route-scoped
 * middleware. No request rewriting, redirects or separate authentication lane. */
export function registerMaishuApiAliases<E extends Env>(app: Hono<E>, prefix = "/oma", alias = "/maishu") {
  for (const route of [...app.routes]) {
    if (route.path === prefix || route.path.startsWith(prefix + "/")) {
      app.on(route.method, alias + route.path.slice(prefix.length), route.handler);
    }
  }
}
