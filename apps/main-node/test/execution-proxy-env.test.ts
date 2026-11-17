import { expect, it } from "vitest";
import { executionProxyEnvironment } from "../../../packages/control-plane-node/src/lib/execution-proxy-env.js";

it("forwards only explicit operator proxy settings and bypasses the control origin", () => {
  const env = executionProxyEnvironment({
    HTTP_PROXY: "http://wrong-control-host:1", PLATFORM_ROOT_SECRET: "must-not-forward",
    MAISHU_EXECUTION_HTTP_PROXY: "http://172.30.0.1:17990",
    MAISHU_EXECUTION_HTTPS_PROXY: "http://172.30.0.1:17990",
    MAISHU_EXECUTION_NO_PROXY: "100.64.148.31,.tail67d792.ts.net",
  }, "https://maishu.littlemai.cn");
  expect(env.HTTP_PROXY).toBe("http://172.30.0.1:17990");
  expect(env.http_proxy).toBe(env.HTTP_PROXY);
  expect(env.NO_PROXY.split(",")).toContain("maishu.littlemai.cn");
  expect(env.NO_PROXY.split(",")).toContain("100.64.148.31");
  expect(JSON.stringify(env)).not.toContain("must-not-forward");
  expect(JSON.stringify(env)).not.toContain("wrong-control-host");
});
it("does not silently inherit container or control-host proxy variables", () => {
  expect(executionProxyEnvironment({ HTTPS_PROXY: "http://host-only:1" })).toEqual({});
});
it.each(["file:///tmp/proxy", "http://user:secret@proxy:123", "http://proxy\n.invalid"])("rejects unsafe proxy configuration without printing it: %s", value => {
  expect(() => executionProxyEnvironment({ MAISHU_EXECUTION_HTTPS_PROXY: value })).toThrow(/代理/);
});
