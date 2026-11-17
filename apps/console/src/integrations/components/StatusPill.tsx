// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { uiText } from "../../i18n/ui-text";
// Shared status pill — used by both Linear and GitHub list/workspace pages.
// The status string set here matches both providers' publication state machine
// since they share the same vocabulary (live | pending_setup | awaiting_install
// | needs_reauth | unpublished). Centralizing avoids drift when we add another
// state and forget to update one of two copies.

export type PublicationStatus =
  | "live"
  | "pending_setup"
  /** GitHub-only intermediate: encrypted credentials staged on the row,
   *  install URL not yet rendered. Slack adapter elides this step (jumps
   *  pending_setup → awaiting_install on first setCredentials) but the
   *  type accepts it for symmetry. */
  | "credentials_filled"
  | "awaiting_install"
  | "needs_reauth"
  | "unpublished";

interface StatusPillProps {
  status: PublicationStatus;
  /** Slightly larger pill — used in the workspace bot-identity header. */
  size?: "sm" | "md";
}

const MAP: Record<PublicationStatus, { label: string; cls: string; dot: string }> = {
  live: {
    label: uiText("Live"),
    cls: "text-success bg-success-subtle",
    dot: "bg-success",
  },
  pending_setup: {
    label: uiText("Pending setup"),
    cls: "text-fg-muted bg-bg-surface",
    dot: "bg-fg-muted",
  },
  credentials_filled: {
    label: uiText("Credentials staged"),
    cls: "text-warning bg-warning-subtle",
    dot: "bg-warning",
  },
  awaiting_install: {
    label: uiText("Awaiting install"),
    cls: "text-warning bg-warning-subtle",
    dot: "bg-warning",
  },
  needs_reauth: {
    label: uiText("Needs reauth"),
    cls: "text-danger bg-danger-subtle",
    dot: "bg-danger",
  },
  unpublished: {
    label: uiText("Unpublished"),
    cls: "text-fg-subtle bg-bg-surface",
    dot: "bg-fg-subtle",
  },
};

export function StatusPill({ status, size = "sm" }: StatusPillProps) {
  const v = MAP[status];
  const padding = size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full ${padding} ${v.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
      {v.label}
    </span>
  );
}
