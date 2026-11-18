// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
/** 麦枢独立标志：承接双侧输入的 M，与麦金任务节点。部署可覆盖图标。 */
import { useBranding } from "../lib/branding";

const SIZE_PX = {
  sm: 24,
  md: 28,
  lg: 32,
  xl: 44,
} as const;

interface LogoProps {
  size?: keyof typeof SIZE_PX;
  /** Brand is the product identity. Current is reserved for intentional
   * monochrome or inverse treatments supplied by the surrounding surface. */
  tone?: "brand" | "current";
  className?: string;
}

export function Logo({ size = "sm", tone = "brand", className = "" }: LogoProps) {
  const px = SIZE_PX[size];
  const branding = useBranding();
  if (branding.logoUrl) {
    // A deployment logo keeps the mark's height; its width follows the image.
    const img = (src: string, variant: string) => (
      <img
        src={src}
        alt={branding.productName}
        style={{ height: px, width: "auto", maxWidth: px * 6 }}
        className={`shrink-0 object-contain ${variant} ${className}`.trim()}
      />
    );
    return branding.logoDarkUrl ? (
      <>
        {img(branding.logoUrl, "dark:hidden")}
        {img(branding.logoDarkUrl, "hidden dark:block")}
      </>
    ) : (
      img(branding.logoUrl, "")
    );
  }
  const fill = tone === "brand" ? "var(--brand)" : "currentColor";
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 100 100"
      role="img"
      aria-label={branding.productName}
      className={`shrink-0 ${className}`.trim()}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M18 77V23L50 44L82 23V77H66V52L50 63L34 52V77Z" fill={fill} />
      <rect x="45" y="73" width="10" height="10" rx="2" fill="var(--maishu-gold, #c7952c)" />
    </svg>
  );
}
