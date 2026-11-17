// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { uiText } from "../i18n/ui-text";
import type { HTMLAttributes } from "react";

/** Direct-host execution notice; credential injection is configured separately. */
export function LocalDebugOnlyWarning({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="note"
      aria-label={uiText("Local debugging only")}
      className={`rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2.5 text-xs text-warning ${className}`.trim()}
      {...props}
    >
      <div className="font-medium">{uiText("Local debugging only — high risk")}</div>
      <p className="mt-1 leading-relaxed text-fg-muted">
        此方式在接入机器上运行智能体，使用该机器的文件和登录配置。
        如需独立隔离环境，请选择沙箱服务；引擎认证可在“引擎凭证”中单独配置。
      </p>
    </div>
  );
}
