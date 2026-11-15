// An image ready to draw or measure, from any address it can load (a data: URL, a blob:)
export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be read"));
    image.src = src;
  });
}

// A canvas as a PNG; failure: what the user is told if the WebView can't give it
export const canvasPng = (canvas: HTMLCanvasElement, failure: string) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error(failure))), "image/png"),
  );
