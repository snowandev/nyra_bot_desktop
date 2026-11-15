import type { Message } from "@/shared/types";

const HIGHLIGHT_NAME = "chat-search";

// Lowercases and drops accents one character at a time, so "accion" finds "Acción". Characters that would
// change length are left as they are, so positions in the folded text still match the original text.
export function foldForSearch(text: string) {
  // Plain ASCII has no accents to drop: most code and English text skips the character-by-character pass
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(text)) return text.toLowerCase();
  let folded = "";
  for (const char of text) {
    const simple = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    folded += simple.length === char.length ? simple : char;
  }
  return folded;
}

// Splits text into the parts that match the query and the rest, ignoring case and accents. foldForSearch keeps
// every character's position, so the folded match points at the same place in the original text.
export function splitByMatches(text: string, query: string): { text: string; isMatch: boolean }[] {
  const folded = foldForSearch(query.trim());
  if (!folded) return [{ text, isMatch: false }];
  const haystack = foldForSearch(text);
  const parts: { text: string; isMatch: boolean }[] = [];
  let from = 0;
  for (let at = haystack.indexOf(folded); at !== -1; at = haystack.indexOf(folded, at + folded.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), isMatch: false });
    parts.push({ text: text.slice(at, at + folded.length), isMatch: true });
    from = at + folded.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), isMatch: false });
  return parts;
}

// Messages never change once written (edits create new ones), so each is folded once. While a reply streams,
// only its own message is new on every frame; refolding the whole conversation each time would be wasted work.
const foldedContent = new WeakMap<Message, string>();

function foldedContentOf(message: Message) {
  let folded = foldedContent.get(message);
  if (folded === undefined) {
    folded = foldForSearch(message.content);
    foldedContent.set(message, folded);
  }
  return folded;
}

// Searches the conversation data, not the screen: older messages may not be rendered yet
export function messagesMatching(messages: Message[], query: string) {
  const folded = foldForSearch(query.trim());
  if (!folded) return [];
  return messages.flatMap((m, i) => (foldedContentOf(m).includes(folded) ? [i] : []));
}

export function clearSearchHighlights() {
  if ("highlights" in CSS) CSS.highlights.delete(HIGHLIGHT_NAME);
}

// Marks every occurrence in the rendered messages without touching their HTML. Older WebKitGTK versions
// lack the Highlight API; there the current message is still outlined.
export function highlightMatches(root: HTMLElement | null, query: string) {
  if (!("highlights" in CSS)) return;
  clearSearchHighlights();
  const folded = foldForSearch(query.trim());
  if (!root || !folded) return;

  const ranges: Range[] = [];
  root.querySelectorAll(".markdown, .user-bubble").forEach((container) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = foldForSearch(node.textContent ?? "");
      for (let at = text.indexOf(folded); at !== -1; at = text.indexOf(folded, at + folded.length)) {
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + folded.length);
        ranges.push(range);
      }
    }
  });
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}
