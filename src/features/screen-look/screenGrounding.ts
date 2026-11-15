import type { ScreenArea, ScreenFit } from "./screenStorage";

// Where something is on a capture of the screen, asked to a model that sees images. Each family was trained to give
// a box its own way, and asked another way it misses more: Qwen's vision models, from 0 to 1000 as [x1, y1, x2, y2]
// (measured with qwen3.8 on a 6K screen: 5 of 8 controls, and asking again on a zoom around the first answer, 7 of
// 8); Gemini, from 0 to 1000 but as [y1, x1, y2, x2]; Claude, in pixels of the image it sees.
export type BoxFormat = "thousandths" | "thousandthsYX" | "pixels";

// By the model's id and provider, never by what the user writes
export function boxFormatFor(model: { id: string; providerId: string }): BoxFormat {
  const id = model.id.toLowerCase();
  if (model.providerId === "anthropic" || id.includes("claude")) return "pixels";
  if (model.providerId === "gemini" || id.includes("gemini")) return "thousandthsYX";
  return "thousandths";
}

// The image a model in pixels reads as it is: Claude shrinks anything over 1568 on its long side or 1.15 megapixels,
// and its pixels would then be those of another image
export const fitFor = (format: BoxFormat): ScreenFit | undefined =>
  format === "pixels" ? { width: 1568, pixels: 1_150_000 } : undefined;

// An image the model is asked about, with its size in pixels
export type Picture = { image: string; width: number; height: number };

export function groundingPrompt(what: string, format: BoxFormat, picture: Picture) {
  const find = `In this screenshot, find ${what}. `;
  const only = " Answer only with the box.";
  if (format === "pixels") {
    return (
      `${find}The image is ${picture.width}×${picture.height} pixels. Give its box as [x1, y1, x2, y2] in pixels of ` +
      `this image, from its top-left corner.${only}`
    );
  }
  if (format === "thousandthsYX") {
    return `${find}Give its box as [ymin, xmin, ymax, xmax], each a number from 0 to 1000.${only}`;
  }
  return `${find}Give its box as [x1, y1, x2, y2], each a number from 0 to 1000 relative to the image's width and height.${only}`;
}

// The first four numbers of the answer, as a box in fractions of the image; null when they aren't a box on it
export function boxOf(answer: string, format: BoxFormat = "thousandths", picture?: Picture): ScreenArea | null {
  const numbers = (answer.match(/-?\d+(?:\.\d+)?/g) ?? []).slice(0, 4).map(Number);
  if (numbers.length < 4) return null;
  const [a, b, c, d] = numbers;
  const [x1, y1, x2, y2] =
    format === "pixels" && picture
      ? [a / picture.width, b / picture.height, c / picture.width, d / picture.height]
      : format === "thousandthsYX"
        ? [b / 1000, a / 1000, d / 1000, c / 1000]
        : [a / 1000, b / 1000, c / 1000, d / 1000];
  const inside = (n: number) => Math.min(Math.max(n, 0), 1);
  const [left, top, right, bottom] = [x1, y1, x2, y2].map(inside);
  const box = {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };
  return box.width > 0 && box.height > 0 ? box : null;
}

// A box found on a zoom, as a place on the whole screen
export const withinZoom = (zoom: ScreenArea, box: ScreenArea): ScreenArea => ({
  x: zoom.x + box.x * zoom.width,
  y: zoom.y + box.y * zoom.height,
  width: box.width * zoom.width,
  height: box.height * zoom.height,
});

type Tools = {
  // The model's answer about an image (a PNG, base64)
  see: (image: string, prompt: string) => Promise<string>;
  // The latest capture, as the model reads it
  view: Picture;
  zoom: (x: number, y: number) => Promise<Picture & { area: ScreenArea }>;
  format: BoxFormat;
};

// Two looks: the whole screen, then a zoom around the first answer, which the second corrects; null when the model
// gives no box
export async function locate(what: string, { see, view, zoom, format }: Tools): Promise<ScreenArea | null> {
  const ask = async (picture: Picture) => boxOf(await see(picture.image, groundingPrompt(what, format, picture)), format, picture);
  const first = await ask(view);
  if (!first) return null;
  const zoomed = await zoom(first.x + first.width / 2, first.y + first.height / 2);
  const second = await ask(zoomed);
  return second ? withinZoom(zoomed.area, second) : first;
}
