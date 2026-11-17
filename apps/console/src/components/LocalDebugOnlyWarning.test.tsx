// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LocalDebugOnlyWarning } from "./LocalDebugOnlyWarning";

describe("LocalDebugOnlyWarning", () => {
  it("makes the direct-host credential boundary explicit", () => {
    render(<LocalDebugOnlyWarning />);

    expect(screen.getByRole("note", { name: "Local debugging only" })).toBeInTheDocument();
    expect(screen.getByText(/Local debugging only — high risk/)).toBeInTheDocument();
    const warning = screen.getByRole("note", { name: "Local debugging only" });
    expect(warning).toHaveTextContent("在接入机器上运行智能体");
    expect(warning).toHaveTextContent("请选择沙箱服务");
    expect(warning).toHaveTextContent("引擎凭证");
  });
});
