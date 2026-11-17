import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NodeControlPlane } from "../src/control-plane";
import type { NodeServer } from "../src/serve";

const fixture = vi.hoisted(() => ({
  server: undefined as NodeServer | undefined,
  plane: undefined as NodeControlPlane | undefined,
  start: vi.fn(),
}));
vi.mock("../src/config.js", async (original) => ({
  ...await original<typeof import("../src/config")>(),
  loadNodeConfig: () => ({ http: { host: "127.0.0.1", port: 0 } }),
}));
vi.mock("../src/components.js", async (original) => ({
  ...await original<typeof import("../src/components")>(), nodeDefaults: async () => ({}),
}));
vi.mock("@open-managed-agents/control-plane-node", async (original) => {
  const actual = await original<typeof import("@open-managed-agents/control-plane-node")>();
  return {
    ...actual,
    createNodeControlPlane: async () => fixture.plane,
    serveNodeControlPlane: async (...args: Parameters<typeof actual.serveNodeControlPlane>) => {
      fixture.server = await actual.serveNodeControlPlane(...args);
      return fixture.server;
    },
  };
});
beforeEach(() => {
  vi.resetModules(); fixture.start.mockReset();
  fixture.plane = {
    processMode: "standalone", backendDescription: "startup-fixture",
    logger: { info: vi.fn() },
    fetch: () => new Response("ok"), start: fixture.start, stop: vi.fn(),
  } as unknown as NodeControlPlane;
});
afterEach(async () => {
  await fixture.server?.close(); fixture.server = undefined;
});
it("accepts HTTP callbacks before starting recovery of existing Work", async () => {
  fixture.start.mockImplementation(async () => {
    if (!fixture.server) throw new Error("Work recovery cannot reach its controller before HTTP listens");
    const { host, port } = fixture.server.address;
    expect(await (await fetch(`http://${host}:${port}/health`)).text()).toBe("ok");
  });
  await import("../src/index");
  expect(fixture.start).toHaveBeenCalledOnce();
});
it("leaves HTTP and background work to the host in serverless mode", async () => {
  Object.assign(fixture.plane!, { processMode: "serverless" });
  await import("../src/index");
  expect(fixture.server).toBeUndefined();
  expect(fixture.start).not.toHaveBeenCalled();
});
