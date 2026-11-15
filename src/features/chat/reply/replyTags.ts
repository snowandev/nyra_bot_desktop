// A model asks the app for something by replying with only a plain text tag (models without tool calling follow it
// too): a web search, the instructions of a skill it only knows by its description, a look at the connected folder,
// or a command to run in it

export type WorkspaceRequest = "read" | "grep" | "find" | "list" | "outline";
// "note" isn't a request: the plan or findings the model writes along with its folder requests
// "run" asks to run a command in the folder and "runBackground" one the reply goes on without; "code" and
// "codeBackground" the same for a program the model wrote; "wait" waits for one running in the background; "output"
// and "outputSearch" read the output of one
type CommandRequest = "run" | "runBackground" | "code" | "codeBackground" | "wait" | "output" | "outputSearch";
// What the model does in the browser it controls: open an address, click or write in a numbered element, press a key,
// look for a text on the whole page, take a screenshot for the user, mark something on the page for them
export type BrowserRequest = "browse" | "click" | "type" | "key" | "pageSearch" | "screenshot" | "mark";
// "escalate": the main model says the task needs the one for demanding tasks («Automático»); "transcribe" asks for the
// transcript of an attached audio; "tool" uses a tool of one of the user's MCP servers; "look" captures the user's
// screen, "point" marks something on it and "watch" waits, while guiding, for the user to do a step; "screenClick",
// "screenType", "screenKey" and "screenScroll" use the user's mouse and keyboard on it
export type RequestKind =
  | "search"
  | "skill"
  | WorkspaceRequest
  | "note"
  | CommandRequest
  | BrowserRequest
  | "escalate"
  | "transcribe"
  | "look"
  | "point"
  | "watch"
  | ScreenAction
  | "tool";

// Each request's tag name, after "nyra-": the one list every pattern below is built from
const TAG_NAMES: Record<RequestKind, string> = {
  search: "search",
  skill: "skill",
  read: "read",
  grep: "grep",
  find: "find",
  list: "list",
  outline: "outline",
  note: "note",
  run: "run",
  runBackground: "run-background",
  code: "code",
  codeBackground: "code-background",
  wait: "wait",
  output: "output",
  outputSearch: "output-search",
  browse: "browse",
  click: "click",
  type: "type",
  key: "key",
  pageSearch: "page-search",
  screenshot: "screenshot",
  mark: "mark",
  escalate: "escalate",
  transcribe: "transcribe",
  look: "look",
  point: "point",
  watch: "watch",
  screenClick: "screen-click",
  screenType: "screen-type",
  screenKey: "screen-key",
  screenScroll: "screen-scroll",
  tool: "tool",
};

const TAGS = Object.fromEntries(
  Object.entries(TAG_NAMES).map(([kind, name]) => [kind, { open: `<nyra-${name}>`, close: `</nyra-${name}>` }]),
) as Record<RequestKind, { open: string; close: string }>;

export const REQUEST_KINDS = Object.keys(TAG_NAMES) as RequestKind[];

// Only this much at the end can be a tag still being written: a "<" further back is never looked for again
export const LONGEST_OPEN_TAG = Math.max(...Object.values(TAGS).map(({ open }) => open.length));
// The full names, for the text from outside that must never pass for a request
export const REQUEST_TAG_NAMES = Object.values(TAG_NAMES).map((name) => `nyra-${name}`);

// For a pattern: "run|run-background|…"
export const requestNames = (kinds: RequestKind[]) => kinds.map((k) => TAG_NAMES[k]).join("|");

// One request's tag with what it holds; group 1 is its name, group 2 its value
const tagPattern = (kinds: RequestKind[]) =>
  new RegExp(`<nyra-(${requestNames(kinds)})>([\\s\\S]*?)<\\/nyra-\\1>`, "g");

export const WORKSPACE_REQUESTS: WorkspaceRequest[] = ["read", "grep", "find", "list", "outline"];
// What runs a command or a program, in the foreground or in the background
const RUN_REQUESTS: CommandRequest[] = ["run", "runBackground", "code", "codeBackground"];

export const isWorkspaceTag = (kind: RequestKind): kind is WorkspaceRequest | "note" =>
  kind === "note" || (WORKSPACE_REQUESTS as RequestKind[]).includes(kind);

export const isRunRequest = (kind: RequestKind) => (RUN_REQUESTS as RequestKind[]).includes(kind);

export const BROWSER_REQUESTS: BrowserRequest[] = ["browse", "click", "type", "key", "pageSearch", "screenshot", "mark"];

export const isBrowserRequest = (kind: RequestKind): kind is BrowserRequest =>
  (BROWSER_REQUESTS as RequestKind[]).includes(kind);

// What the model does on the user's screen: looking and pointing, and acting with their mouse and keyboard
export type ScreenAction = "screenClick" | "screenType" | "screenKey" | "screenScroll";
export type ScreenRequest = "look" | "point" | "watch" | ScreenAction;
export const SCREEN_ACTIONS: ScreenAction[] = ["screenClick", "screenType", "screenKey", "screenScroll"];
export const SCREEN_REQUESTS: ScreenRequest[] = ["look", "point", "watch", ...SCREEN_ACTIONS];

export const isScreenAction = (kind: RequestKind): kind is ScreenAction =>
  (SCREEN_ACTIONS as RequestKind[]).includes(kind);

export const isScreenRequest = (kind: RequestKind): kind is ScreenRequest =>
  (SCREEN_REQUESTS as RequestKind[]).includes(kind);

const WORKSPACE_TAG = tagPattern(["note", ...WORKSPACE_REQUESTS]);

// What models get wrong when writing a request: a tag left inside another one ("<nyra-read><nyra-read>a.ts"), or a
// line of the index copied with its count ("src/cl/ (57 files)"), which would otherwise be looked for as a path
export function cleanRequestValue(kind: WorkspaceRequest, value: string) {
  const untagged = value.replace(/<\/?nyra-[a-z]+>/g, "");
  return (kind === "grep" || kind === "find" ? untagged : untagged.replace(/[ \t]*\(\d+ files?\)/g, "")).trim();
}

// A round of folder work: everything the model asked for in one reply, its notes (also plain text before the
// first tag), and where its last tag ends, past which it would be answering results it hasn't seen
export function readWorkspaceRound(text: string) {
  const requests: { kind: WorkspaceRequest; value: string }[] = [];
  const notes: string[] = [];
  let end = 0;
  let first = -1;
  for (const match of text.matchAll(WORKSPACE_TAG)) {
    if (first === -1) first = match.index;
    const kind = match[1] as WorkspaceRequest | "note";
    const value = kind === "note" ? match[2].trim() : cleanRequestValue(kind, match[2]);
    if (kind === "note") {
      if (value) notes.push(value);
    } else if (value) {
      requests.push({ kind, value });
    }
    end = match.index + match[0].length;
  }
  const preface = first > 0 ? text.slice(0, first).trim() : "";
  return { requests, notes: preface ? [preface, ...notes] : notes, end, rest: text.slice(end).trim() };
}

// Text the model keeps writing after its last folder tag, as if it already had the results
export function charsAfterLastWorkspaceTag(text: string) {
  return text.length - readWorkspaceRound(text).end;
}

const RUN_TAG = tagPattern(RUN_REQUESTS);
// Where a command or program request starts, to tell it apart from notes written before it
export const RUN_TAG_START = new RegExp(`<nyra-(${requestNames(RUN_REQUESTS)})>`);

export type CommandAsked = { command: string; background: boolean; code?: { language: string; source: string } };

// The names models give a block, as the interpreters are called
const LANGUAGE_ALIASES: Record<string, string> = {
  py: "python",
  py3: "python",
  python3: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  nodejs: "javascript",
};

// A program comes in a fenced block that names its language; without one it is taken as Python. The block ends at
// the tag's last fence, so a fence inside the program (a string that prints Markdown) doesn't cut it.
export function programOf(text: string) {
  const opening = text.match(/```[ \t]*([\w+#-]*)[^\n]*\n/);
  const named = (opening?.[1] || "python").toLowerCase();
  const body = opening ? text.slice((opening.index ?? 0) + opening[0].length).replace(/\n?[ \t]*```\s*$/, "") : text;
  return { language: LANGUAGE_ALIASES[named] ?? named, source: body.replace(/\s+$/, "") };
}

// The commands of one request, in order, and which go on in the background; start is where the first tag begins
// (what comes before stays in the reply, above their cards) and end where the last one ends
export function readRunRound(text: string) {
  const commands: CommandAsked[] = [];
  let start = -1;
  let end = 0;
  for (const match of text.matchAll(RUN_TAG)) {
    if (start === -1) start = match.index;
    if (match[1] === "code" || match[1] === "code-background") {
      const code = programOf(match[2]);
      if (code.source.trim()) commands.push({ command: "", background: match[1] === "code-background", code });
    } else {
      const command = match[2].replace(/<\/?nyra-[a-z-]+>/g, "").trim();
      if (command) commands.push({ command, background: match[1] === "run-background" });
    }
    end = match.index + match[0].length;
  }
  return { commands, start: Math.max(start, 0), end };
}

// Text written past the last command or program, never one still being written: a long program isn't an answer
export function charsAfterLastRunTag(text: string) {
  const { end } = readRunRound(text);
  return RUN_TAG_START.test(text.slice(end)) ? 0 : text.length - end;
}

// Where the text that can be shown ends: a tag being written ("<nyra-ru") is held back until it is clear what it is
export function shownUpTo(text: string) {
  const end = text.slice(-LONGEST_OPEN_TAG);
  const near = end.lastIndexOf("<");
  if (near === -1) return text.length;
  const at = text.length - end.length + near;
  const tail = text.slice(at);
  const opening = Object.values(TAGS).some(({ open }) => open.startsWith(tail));
  return opening ? at : text.length;
}

export const tagged = (kind: RequestKind, value: string) => `${TAGS[kind].open}${value}${TAGS[kind].close}`;

export const closingTag = (kind: RequestKind) => TAGS[kind].close;

type GateState =
  | { kind: "deciding" }
  | { kind: "answer" }
  | { kind: "request"; request: RequestKind; value: string; preface: string };

// Holds back the start of a reply until it is clear whether the model is answering or asking for something, so the
// tag is never shown. A request found later in the text (after a short preface) still counts; the first one wins.
export function readReply(text: string, allowed: RequestKind[]): GateState {
  if (allowed.length === 0) return { kind: "answer" };
  const found = allowed
    .map((request) => ({ request, start: text.indexOf(TAGS[request].open) }))
    .filter((f) => f.start !== -1)
    .sort((a, b) => a.start - b.start)[0];
  if (found) {
    const { open, close } = TAGS[found.request];
    const end = text.indexOf(close, found.start);
    if (end === -1) return { kind: "deciding" };
    const value = text.slice(found.start + open.length, end).trim();
    if (!value) return { kind: "answer" };
    return { kind: "request", request: found.request, value, preface: text.slice(0, found.start).trim() };
  }
  const trimmed = text.trimStart();
  const mayBeTag = trimmed === "" || allowed.some((request) => TAGS[request].open.startsWith(trimmed));
  return mayBeTag ? { kind: "deciding" } : { kind: "answer" };
}

// A tag the model wrote when it couldn't ask any more is dropped from what the user reads
const REQUEST_NAMES = requestNames(REQUEST_KINDS);

// Also a closing tag left alone, from a request the model wrote without its opening
export const withoutRequestTags = (text: string) =>
  text
    .replace(new RegExp(`<nyra-(${REQUEST_NAMES})>[\\s\\S]*?<\\/nyra-\\1>`, "g"), "")
    .replace(new RegExp(`<nyra-(${REQUEST_NAMES})>[\\s\\S]*$`), "")
    .replace(new RegExp(`<\\/nyra-(${REQUEST_NAMES})>`, "g"), "")
    .trim();

// A request's closing tag with no opening before it: the model wrote the tag wrong, so nothing was done
export function strayClosing(text: string, kinds: RequestKind[]): RequestKind | null {
  return (
    kinds.find((kind) => {
      const at = text.indexOf(TAGS[kind].close);
      return at !== -1 && text.lastIndexOf(TAGS[kind].open, at) === -1;
    }) ?? null
  );
}
