import { afterEach, expect, it } from "vitest";
import { uiText } from "./ui-text";

afterEach(() => { localStorage.removeItem("maishu-locale"); localStorage.removeItem("oma-locale"); });
it("uses Chinese for an unconfigured deployment and leaves technical values intact", () => {
  localStorage.removeItem("maishu-locale"); localStorage.removeItem("oma-locale");
  expect(uiText("Read / Write")).toBe("读写");
  expect(uiText("Connect a local machine")).toBe("连接执行机器");
  expect(uiText("codex-acp")).toBe("codex-acp");
});
it("honors the explicit language choice and legacy preference", () => {
  localStorage.setItem("maishu-locale", "en");
  expect(uiText("Download")).toBe("Download");
  localStorage.removeItem("maishu-locale");
  localStorage.setItem("oma-locale", "zh-CN");
  expect(uiText("Download")).toBe("下载");
});

it("localizes dynamic UI copy without changing inserted names", () => {
  localStorage.setItem("maishu-locale", "zh-CN");
  expect(uiText("Log in to 麦枢")).toBe("登录麦枢");
  expect(uiText("Working for 12s")).toBe("已执行 12s");
  expect(uiText("Delete 项目A? This cannot be undone.")).toBe("删除“项目A”？此操作无法撤销。");
});
