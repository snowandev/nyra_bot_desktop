import { loadImage } from "@/shared/lib/pictures";
import { i18n } from "@/shared/i18n/i18n";

// Vision models read an image at most about this big on its longer side; a larger one only costs more to send
const MAX_SIDE = 1568;
const JPEG_QUALITY = 0.85;

const opened = (src: string) =>
  loadImage(src).catch((e: unknown) => {
    throw new Error(i18n.t("attachments.errors.imageOpen"), { cause: e });
  });

// An image as a vision model gets it: no larger than it can use, as a JPEG (base64). An <img> rather than
// createImageBitmap, which older WebKitGTK and WKWebView versions lack.
export async function scaledForModel(base64: string, mimeType: string) {
  const image = await opened(`data:${mimeType};base64,${base64}`);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(i18n.t("attachments.errors.imagePrepare"));
  // JPEG has no transparency: a transparent PNG would turn black
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1] ?? "";
}
