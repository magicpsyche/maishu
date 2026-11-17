// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "../mocks/server";

// Fail any test that fires a network request not explicitly handled —
// prevents "why are my tests flaky" debugging sessions where a stray
// fetch hits the real backend (or stalls forever).
localStorage.setItem("maishu-locale", "en");

// Existing behavior tests intentionally exercise the retained English locale.
beforeEach(() => localStorage.setItem("maishu-locale", "en"));
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
