import { useId } from "react";
import { GLYPH_WEIGHTS } from "./brandGlyph";

type Props = {
  size?: number;
  // In the brand's gradient, for the large marks; otherwise in the text's color (currentColor)
  gradient?: boolean;
  className?: string;
};

// Nyra's glyph, with the weight that fits its size. Never below 16 px: smaller, its eyes and node blur together.
export function BrandIcon({ size = 18, gradient = false, className }: Props) {
  // An SVG reference can't hold the characters useId may return
  const gradientId = `brand-${useId().replace(/[^\w-]/g, "")}`;
  const shown = Math.max(size, 16);
  const path = (GLYPH_WEIGHTS.find((weight) => shown >= weight.minSize) ?? GLYPH_WEIGHTS[GLYPH_WEIGHTS.length - 1]).path;
  return (
    <svg width={shown} height={shown} viewBox="0 0 64 64" className={className} aria-hidden="true">
      {gradient && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--glyph-from)" }} />
            <stop offset="1" style={{ stopColor: "var(--glyph-to)" }} />
          </linearGradient>
        </defs>
      )}
      <path d={path} fill={gradient ? `url(#${gradientId})` : "currentColor"} />
    </svg>
  );
}
