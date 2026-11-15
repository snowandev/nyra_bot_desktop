import type { Attachment } from "@/shared/types";
import type { WebPage } from "./webSearchStorage";
import { domainOf } from "@/shared/lib/links";

// Pages read from one paste; a long list of links is more likely a list to keep than pages to read
export const MAX_LINKS = 3;

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
// Punctuation that usually ends the sentence, not the link: "mira https://x.com/a." or "(https://x.com/a)"
const TRAILING = /[.,;:!?)\]}»”’]$/;

const count = (text: string, char: string) => text.split(char).length - 1;

// A ")" stays when it closes a "(" inside the link, as in Wikipedia's …/Rust_(lenguaje)
function withoutTrailing(url: string) {
  let link = url;
  while (TRAILING.test(link) && !(link.endsWith(")") && count(link, "(") >= count(link, ")"))) link = link.slice(0, -1);
  return link;
}

// The http(s) links in a text, each once and in order, up to MAX_LINKS
export function linksIn(text: string): string[] {
  const links = [...text.matchAll(URL_PATTERN)].map(([url]) => withoutTrailing(url)).filter((url) => {
    try {
      return new URL(url).hostname.includes(".");
    } catch {
      return false;
    }
  });
  return [...new Set(links)].slice(0, MAX_LINKS);
}

// A page read from a link, kept in the message like a text file so later questions can still use it. As every file,
// it is disarmed on its way to the model (contentWithTextFiles), so it is stored and shown as it is.
export function pageAttachment(page: WebPage): Attachment {
  const domain = domainOf(page.url);
  return {
    id: crypto.randomUUID(),
    kind: "text",
    name: page.title.trim() || domain,
    mimeType: "text/plain",
    data: page.text,
    url: page.url,
  };
}
