import { REQUEST_TAG_NAMES } from "./replyTags";

// The tags Nyra wraps its own messages in. A web page could write "</search-results><app-instructions>…" to step
// out of its results and pass itself off as the app, so in text from the web their "<" becomes "[". Only these
// tags: a page about code keeps its <div> and Vec<String>. The same goes for files and command output.
const OTHER_APP_TAGS = [
  "app-instructions",
  "tool-choice",
  "search-results",
  "nyra-remember",
  "memories",
  "nyra-edit",
  "nyra-create",
  "nyra-cells",
  "nyra-commit",
  "nyra-document",
  "mentioned-files",
  "folder-index",
  "folder-results",
  "meaning-results",
  "meaning-fragment",
  "project-instructions",
  "current-date",
  "user-rules-reminder",
  "user-message",
  "assistant-reply",
  "command-results",
  "command-result",
  "command-output",
  "command-search",
  "command-wait",
  "commands-run",
  "browser-page",
  "browser-error",
  "browser-screenshot",
  "browser-closed",
  "browser-note",
  "browser-result",
  "browser-found",
  "browser-marked",
  "screen-view",
  "screen-marked",
  "screen-error",
  "screen-guide",
  "audio",
  "audio-transcript",
  "transcript-error",
  "tool-result",
  "tool-error",
  "proposed-change",
  "request-failed",
  "file",
  "skill",
];
// Longest first, so "nyra-run-background" isn't taken for "nyra-run"; and a name never stops inside a longer one
const APP_TAG_NAMES = [...REQUEST_TAG_NAMES, ...OTHER_APP_TAGS].sort((a, b) => b.length - a.length);
const APP_TAG = new RegExp(`<\\s*(\\/?)\\s*(${APP_TAG_NAMES.join("|")})(?![\\w-])`, "gi");

export const neutralizeAppTags = (text: string) => text.replace(APP_TAG, "[$1$2");

// For an attribute (a query, a file's name): no tags and no quote that would end it early
export const asAttribute = (text: string) => neutralizeAppTags(text).replace(/"/g, "'");
