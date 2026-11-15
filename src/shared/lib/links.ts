import { openUrl } from "@tauri-apps/plugin-opener";

// The only kinds of links a reply may open; anything else (javascript:, file:, custom schemes) is shown as text
const OPENABLE_PROTOCOLS = ["http:", "https:", "mailto:"];

// Images the model writes as data: URLs need no network, so they can't leak anything
const INLINE_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,/i;

export function openableUrl(href: string | undefined) {
  if (!href) return null;
  try {
    const url = new URL(href);
    return OPENABLE_PROTOCOLS.includes(url.protocol) ? url.href : null;
  } catch {
    // Relative or malformed: there is no page of the app it could sensibly point to
    return null;
  }
}

// In the system browser, never inside the app window
export const openInBrowser = (url: string) => openUrl(url);

export function isInlineImage(src: string | undefined) {
  return !!src && INLINE_IMAGE.test(src);
}

// A link's site as people read it, for chips and source lists: "es.wikipedia.org", without "www."
export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
