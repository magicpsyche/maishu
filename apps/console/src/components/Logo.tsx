// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
/**
 * Canonical OpenMA mark. Inlined as React SVG (no `<img>` round-
 * trip and no width/height-attr-vs-CSS-class mismatch that previously
 * caused an 8-px collapse on first paint when CSS resized 32×32 →
 * 24×24).
 *
 * trip) and filled with the semantic brand token so a parent text color cannot
 * accidentally turn the product mark gray.
 */
import { useBranding } from "../lib/branding";

const SIZE_PX = {
  sm: 24,
  md: 28,
  lg: 32,
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
      viewBox="0 0 48 48"
      role="img"
      aria-label={branding.productName}
      className={`shrink-0 ${className}`.trim()}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="48" height="48" rx="13" fill={fill} />
      <g fill="none" stroke="var(--brand-fg, white)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 31V17l11 9 11-9v14M24 26v10M13 12l11 7 11-7" />
        <circle cx="24" cy="26" r="3.5" fill={fill} />
      </g>
    </svg>
  );
}
