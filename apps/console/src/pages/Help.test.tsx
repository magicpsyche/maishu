import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { Help } from "./Help";

function open() { render(<MemoryRouter><Help /></MemoryRouter>); }
it("links each Chinese setup step to the real local console path", () => {
  open();
  for (const [name, href] of [
    ["配置沙箱后端", "/settings/sandbox"], ["管理引擎凭证", "/settings/harness-credentials"],
    ["创建智能体", "/agents"], ["管理执行环境", "/environments"], ["创建会话", "/sessions"],
    ["查看文件", "/files"], ["管理记忆库", "/memory"],
  ]) expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  expect(screen.getByText(/\/downloads\/install\.sh/)).toHaveTextContent(window.location.origin);
  expect(screen.getByText(/引擎的订阅凭证不会自动成为平台判分凭证/)).toBeInTheDocument();
});
it("retains the upstream attribution and complete Apache license as explicitly labelled originals", () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "查看版权与第三方归属声明（NOTICE 原文）" }));
  expect(screen.getByText(/Copyright 2025 Open Managed Agents Contributors/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看 Apache License 2.0 许可原文" }));
  expect(screen.getByText(/TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "上游技术参考（外部站点）" })).toHaveAttribute("href", "https://github.com/openma-ai/open-managed-agents");
});
