export const FONT_SCALE = { min: 0.75, max: 1.25, step: 0.05, default: 1 };

// The stored value comes from localStorage, so it may be out of range or not a number at all
export function clampFontScale(scale: unknown) {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return FONT_SCALE.default;
  // Rounded so slider steps like 0.75 + 5 × 0.05 land exactly on 1 and match the default
  const rounded = Math.round(scale * 100) / 100;
  return Math.min(FONT_SCALE.max, Math.max(FONT_SCALE.min, rounded));
}

export function applyFontScale(scale: number) {
  document.documentElement.style.setProperty("--font-scale", String(clampFontScale(scale)));
}

export function formatFontScale(scale: number) {
  return `${Math.round(scale * 100)} %`;
}
