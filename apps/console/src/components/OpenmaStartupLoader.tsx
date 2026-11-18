import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";

/** 麦枢页面级加载标志；内联操作沿用紧凑加载状态。 */
export function OpenmaStartupLoader({ className, label }: { className?: string; label?: string } = {}) {
  const { t } = useI18n();
  return (
    <svg role="status" aria-label={label ?? t.common.loading} viewBox="0 0 100 100"
      className={cn("h-[64px] w-[64px] overflow-visible fill-current text-brand", className)}>
      <path d="M18 77V23L50 44L82 23V77H66V52L50 63L34 52V77Z" />
      <rect className="openma-startup-loader-dot" x="45" y="73" width="10" height="10" rx="2" fill="var(--maishu-gold, #c7952c)" />
    </svg>
  );
}
