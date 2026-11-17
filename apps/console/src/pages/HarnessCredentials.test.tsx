import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import { HarnessCredentials } from "./HarnessCredentials";
const endpoint = "/v1/maishu/admin/harness-credentials";
let writes: Record<string, unknown>[] = [];
const row = { id: "hc_test", name: "正式研究账号", kind: "codex", revision: "rev_three", allowedAgentIds: ["agent_A"], allowWorkspace: false, updatedAt: "2026-11-17" };
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  writes = [];
  server.use(
    http.get(endpoint, () => HttpResponse.json({ data: [row] })),
    http.get("/v1/agents", ({ request }) => new URL(request.url).searchParams.get("page") === "second"
      ? HttpResponse.json({ data: [{ id: "agent_B", name: "审查助手" }, { id: "agent_old", name: "旧智能体", archived_at: "2026-11-01" }], next_page: null })
      : HttpResponse.json({ data: [{ id: "agent_A", name: "研究助手" }], next_page: "second" })),
    http.post(endpoint, async ({ request }) => { writes.push(await request.json() as Record<string, unknown>); return HttpResponse.json(row); }),
    http.put(endpoint + "/:id", async ({ request }) => { writes.push(await request.json() as Record<string, unknown>); return HttpResponse.json(row); }),
  );
});
function open() { render(<MemoryRouter><HarnessCredentials /></MemoryRouter>); }
it("can save an ungranted credential draft without broadening its permissions", async () => {
  open(); await screen.findByText("正式研究账号");
  fireEvent.click(screen.getByRole("button", { name: "添加引擎凭证" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "测试凭证" } });
  fireEvent.change(screen.getByLabelText("auth.json 内容"), { target: { value: '{"token":"synthetic-only"}' } });
  fireEvent.click(screen.getByRole("button", { name: "保存凭证" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ allowedAgentIds: [], allowWorkspace: false, content: '{"token":"synthetic-only"}' });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(document.body.textContent).not.toContain("synthetic-only");
});
it("updates metadata with a revision guard without sending an empty replacement secret", async () => {
  open(); await screen.findByText("正式研究账号");
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  expect(screen.getByLabelText("auth.json 内容（留空保留原值）")).toHaveValue("");
  expect(await screen.findByRole("checkbox", { name: "研究助手" })).toBeChecked();
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "重命名账号" } });
  fireEvent.click(screen.getByRole("button", { name: "保存凭证" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ name: "重命名账号", expectedRevision: "rev_three", allowedAgentIds: ["agent_A"] });
  expect(writes[0]).not.toHaveProperty("content");
});
it("selects real agents by name across pages and preserves unseen grants until explicitly revoked", async () => {
  server.use(http.get(endpoint, () => HttpResponse.json({ data: [{ ...row, allowedAgentIds: ["agent_A", "agent_old", "agent_hidden"] }] })));
  open(); await screen.findByText("正式研究账号");
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "审查助手" }));
  expect(screen.getByText("旧智能体（已归档）")).toBeInTheDocument();
  expect(screen.getByText("agent_hidden")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索本工作空间智能体"), { target: { value: "没有这个名称" } });
  fireEvent.click(screen.getByRole("button", { name: "撤回旧智能体的授权" }));
  fireEvent.click(screen.getByRole("button", { name: "保存凭证" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ allowedAgentIds: ["agent_A", "agent_hidden", "agent_B"], allowWorkspace: false });
});
it("reads a local file only into the one-time credential draft", async () => {
  open(); await screen.findByText("正式研究账号");
  fireEvent.click(screen.getByRole("button", { name: "添加引擎凭证" }));
  const file = new File(['{"token":"local-synthetic"}'], "auth.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => '{"token":"local-synthetic"}' });
  fireEvent.change(screen.getByLabelText("选择本地认证文件（选填）"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText("auth.json 内容")).toHaveValue('{"token":"local-synthetic"}'));
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "添加引擎凭证" }));
  expect(screen.getByLabelText("auth.json 内容")).toHaveValue("");
});
it("does not offer credential writes when the deployment reports the feature unavailable", async () => {
  server.use(http.get("/v1/maishu/capabilities", () => HttpResponse.json({ harness_credentials: false })));
  open();
  expect(await screen.findByText("当前部署不支持引擎凭证设置。请在支持此功能的自托管管理端配置。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加引擎凭证" })).toBeDisabled();
  expect(writes).toHaveLength(0);
});
