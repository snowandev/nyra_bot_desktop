// Part of a PDF a vision model gets as an image: a whole page (a scan, a slide, a chart drawn with lines) or a
// figure cut out of a page of text. Pages counted from 1; data is a base64 JPEG.
export type PdfVisual = { page: number; kind: "page" | "figure"; data: string };

export type Attachment = {
  id: string;
  kind: "image" | "text" | "pdf" | "audio";
  name: string;
  mimeType: string;
  // Base64 without the data: prefix for images, plain content for text files, extracted text for PDFs
  data: string;
  // PDF only: the file itself (base64), so the viewer draws it as it is
  pdf?: string;
  pageCount?: number;
  // PDF only: what vision models see besides its text; pages of text send nothing
  visuals?: PdfVisual[];
  // PDF only, when it had more images than are sent: the last page whose images were looked at
  visualsUpToPage?: number;
  // PDF only, attached with earlier versions: every page as a base64 JPEG
  pages?: string[];
  // A spreadsheet (Excel, OpenDocument): the file itself in base64, kept so a changed copy can be made from it;
  // data is then its sheets as text tables
  workbook?: string;
  // A version Nyra made of an attached spreadsheet: lineage is the id of the attachment it all started from, and
  // number counts from 2 (the attachment itself is 1)
  version?: { lineage: string; number: number };
  // A web page read from a pasted link: where it is, after redirects
  url?: string;
  // Audio only: kept as a file of its own (data is empty), how long it lasts in seconds, and, once Nyra transcribed
  // it, the id of its transcript, a text file attached next to it
  duration?: number;
  transcript?: string;
  // Audio only: a meeting Nyra recorded, the user's microphone on one side and the computer's sound on the other
  meeting?: boolean;
};

// A page Nyra read for a reply; n is the number the model cites it by
export type WebSource = { n: number; title: string; url: string };

export type WebSearchStep = {
  query: string;
  engine: "duckduckgo" | "wikipedia";
  sources: WebSource[];
};

// What a reply searched and read; failed means no search could be made and the model answered from memory
export type WebSearchRecord = { steps: WebSearchStep[]; failed?: boolean };

export type Message = {
  role: "user" | "assistant";
  content: string;
  // The name of the model that wrote a reply, as shown, and its id
  model?: string;
  modelId?: string;
  attachments?: Attachment[];
  // Ids of earlier attachments sent again with this message; stored once and resolved when talking to the model
  references?: string[];
  // A skill the user chose for this message with "/" or a welcome card, applied even if the text doesn't ask for it
  skill?: string;
  // Sent with /init: its reply writes the project's NYRA.md, also when it is answered again
  writesGuide?: boolean;
  usage?: ContextUsage;
  stats?: ReplyStats;
  // Assistant replies that searched the web
  webSearch?: WebSearchRecord;
  // What a reasoning model thought before answering; never sent back to the model
  reasoning?: Reasoning;
  // Skills the model asked for and followed in this reply (not the ones chosen with "/", shown on the user's message)
  skillsUsed?: string[];
  // Memories the model saved with this reply, as worded then; they are changed or deleted only in Settings
  memoriesSaved?: SavedMemory[];
  // What the reply looked at in the conversation's folder; only the list, never the content
  workspaceConsult?: WorkspaceConsult;
  // Changes the reply proposed to the folder's files, and what the user decided about each
  workspaceChanges?: ProposedChange[];
  // New versions of attached spreadsheets the reply made; their files are in its attachments
  sheetVersions?: SheetVersion[];
  // Commands the reply asked to run in the folder, with what the user decided and what they printed
  commands?: CommandRun[];
  // A commit the reply proposed: the user edits its message, chooses the files and makes it on its card
  commitProposal?: CommitProposal;
  // What the reply did in the browser, for its card
  browser?: BrowserRecord;
  // What the reply looked at and pointed out on the user's screen, for its card
  screen?: ScreenRecord;
  // Tools of the user's MCP servers the reply asked to use, each where it asked, with what the user decided and what
  // they returned
  toolCalls?: ToolCall[];
  // Transcripts of attached audio the reply got, shown as documents where it asked for them; each is attached to the
  // message that brought its audio, by this id
  transcripts?: { at: number; id: string }[];
  // The other versions of a regenerated reply; the one shown is the message itself, at versionIndex among all
  otherVersions?: ReplyVersion[];
  versionIndex?: number;
};

export type SavedMemory = { id: string; text: string };

// asking: waiting for the user to allow it; denied: the user didn't
// "stopped": the user stopped the reply before it was allowed or before it ended
type ToolCallState = "asking" | "running" | "done" | "failed" | "denied" | "stopped";

export type ToolCall = {
  id: string;
  // Where its card goes in the reply's text
  at: number;
  server: string;
  serverName: string;
  tool: string;
  // As the model wrote them, as JSON text
  arguments: string;
  state: ToolCallState;
  // What it returned, cut short for its card; the model got it whole
  result?: string;
};

// look: a capture of the user's screen; point: a mark on it; unpoint: the marks taken away; watch: a guide waiting
// for the user to do a step. Without an outcome it is still going on; missing: what it meant to point at wasn't
// found; refused: the user didn't let it look; done: the user said they did the step; ended: they ended the guide;
// idle: nothing changed for a long while
export type ScreenStep = {
  kind: "look" | "point" | "unpoint" | "watch" | "click" | "type" | "key" | "scroll";
  // What it pointed at, as its note says, the step the user had to do, or what it clicked, typed or pressed
  target: string;
  // taken: the user stopped Nyra while it was using their mouse and keyboard; inNyra: it didn't type or press keys
  // because the keyboard was in Nyra's own window
  outcome?: "ok" | "missing" | "refused" | "failed" | "done" | "ended" | "idle" | "taken" | "inNyra";
  error?: string;
};

// Where its card goes in the reply's text, and its steps
export type ScreenRecord = { at: number; steps: ScreenStep[] };

// What the app checked an action in the browser did, as its card tells it; refused: the user didn't allow the site
export type BrowserOutcome =
  | { key: "navigated"; site: string }
  | { key: "typed" | "notTyped"; label: string }
  | { key: "changed" | "unchanged" | "shot" | "refused" }
  | { key: "found"; text: string; count: number }
  | { key: "marked"; count: number }
  | { key: "markMissing" | "markHidden" | "unmarked" }
  | { key: "failed"; error?: string };

// mark: something pointed out on the page for the user; unmark: the marks taken away
export type BrowserStepKind = "browse" | "click" | "type" | "key" | "pageSearch" | "screenshot" | "mark" | "unmark";

// One action of a reply in the browser; without an outcome it is still going on
export type BrowserStep = {
  kind: BrowserStepKind;
  // The site, the element's label, the key or the text looked for
  target: string;
  // What it wrote in a field; a password is never kept, only that it was one
  typed?: string;
  secret?: boolean;
  outcome?: BrowserOutcome;
};

// What a reply did in the browser: where its card goes in the text, its steps, and the page as it last saw it, with a
// small JPEG of the window (base64)
export type BrowserRecord = { at: number; steps: BrowserStep[]; url: string; title: string; thumbnail?: string };

export type CommitProposal = {
  message: string;
  status: "pending" | "committed" | "discarded";
  // The commit's short id once made
  commitId?: string;
};

// queued: after an earlier one of the same request; asking: it printed a question and waits for an answer
type CommandRunState = "queued" | "pending" | "running" | "asking" | "done" | "failed" | "stopped" | "rejected";

// A command the model asked to run in the connected folder; nothing runs until the user approves it
// The languages Nyra runs programs in, when this computer has their interpreter
export type CodeLanguage = "python" | "javascript";

export type CommandRun = {
  id: string;
  // For a program, what runs it once it is saved; empty until then
  command: string;
  // A program the model wrote, run by its interpreter instead of a command line, from its conversation's folder
  // language is the one the model named, which this computer may not run
  code?: { language: string; source: string; conversationId: string };
  // What a program created or changed in the conversation's folder, to see or save
  files?: { path: string; size: number }[];
  // Changed by the user before running it
  edited?: boolean;
  // Not run: the user wrote this to Nyra instead, while it waited for their approval
  answer?: string;
  // The reply goes on while it runs, and gets its result when it ends
  background?: boolean;
  // Still running when its reply ended, and left running (a server): its result reaches the model with the user's
  // next message
  detached?: boolean;
  // The connected folder it runs in
  root: string;
  folder: string;
  // Where its card goes in the reply's text; commands of one request share it and show as a numbered group
  at: number;
  // Its number in the reply, as the model refers to it
  n: number;
  state: CommandRunState;
  exitCode?: number;
  startedAt?: number;
  durationMs?: number;
  // Everything it printed, without terminal codes; past the line limit the middle gives way
  output?: string;
  lines?: number;
  // The terminal hides what is typed: the answer is a password, and it is never kept
  hiddenInput?: boolean;
  // Parts of the output the model read later in the reply
  reads?: { from: number; to: number }[];
};

// A folder of the user's computer the model can read in this conversation; path is as Rust resolved it
export type WorkspaceFolder = { path: string; name: string };

export type WorkspaceSkipReason =
  | "secret"
  | "ignored"
  | "outside"
  | "binary"
  | "tooLarge"
  | "missing"
  // A PDF that couldn't be opened (damaged, password), with nothing in it, or scanned for a model without vision
  | "unreadable"
  | "noText"
  | "scannedNoVision"
  | "imageNoVision"
  // A spreadsheet Nyra only reads (.xls, .ods)
  | "readOnly"
  // A sheet protected in Excel, which Nyra doesn't unprotect
  | "sheetProtected";

export type ChangeBlock = { search: string; replace: string };

// One cell of a spreadsheet as the model asked for it: "120", "=SUM(B2:B9)", "Luz", or "" to empty it
export type CellChangeSpec = { sheet: string; cell: string; value: string };

// What a cell held before a change was applied, to show it later: the file then holds the new values
type CellBefore = { sheet: string; cell: string; value: string; formula?: string };

// A new version of an attached spreadsheet, made by a reply; the file is the attachment with the same id, kept with
// that reply. The attachment the user sent never changes.
export type SheetVersion = {
  id: string;
  file: string;
  number: number;
  // The attachment it was made from: the original or an earlier version
  baseId: string;
  cells: CellChangeSpec[];
  cellsBefore: CellBefore[];
  // Why it couldn't be made (a sheet that doesn't exist, a protected sheet); then there is no file
  error?: string;
  // Made by the user from an earlier version ("Seguir desde esta"), by its number: a copy of it, with no changes
  restoredFrom?: number;
};

// A change to one file of the connected folder; nothing is written until the user applies it
export type ProposedChange = {
  id: string;
  root: string;
  path: string;
  kind: "edit" | "create" | "cells";
  // edit: each part of the file to replace, in order; create: the whole new file; cells: the spreadsheet's cells
  blocks: ChangeBlock[];
  content?: string;
  cells?: CellChangeSpec[];
  cellsBefore?: CellBefore[];
  // A workbook Nyra only reads (.xls, .ods): the changes went into this new .xlsx next to it
  copiedTo?: string;
  // The file's modification time when the reply looked at it; a different one means it changed since
  baseModified?: number;
  status: "pending" | "applied" | "discarded" | "undone" | "noMatch" | "conflict" | "protected";
  // Opened in the review: only then can it be applied
  reviewed?: boolean;
  reason?: WorkspaceSkipReason;
  // The block that doesn't match the file
  failedBlock?: number;
  // Redone by Nyra after it didn't fit the file ("Pedir que lo corrija"); it has to be reviewed again
  corrected?: boolean;
  // How to undo it: the copy of what was there and the file's time right after writing
  applied?: { backup: string; modified: number };
  // Made by Claude Code in a conversation imported from it: already in the file, with no copy to undo it
  importedFrom?: "claudeCode";
};

export type WorkspaceConsult = {
  folder: string;
  // Where the folder was then, so its files can still be shown if the conversation later connects another one
  root: string;
  // lines is set when only part of the file was read; modified tells later whether the file changed since
  read: { path: string; size: number; modified: number; lines?: { from: number; to: number; total: number } }[];
  // byMeaning: found by what the code is about, not by its exact words; total is then fragments, not matches
  searches: { query: string; total: number; files: { path: string; count: number }[]; byMeaning?: boolean }[];
  listed: string[];
  // Folders or files whose definitions it mapped; missing in replies from before it existed
  outlined?: string[];
  // The project's instruction files it followed (NYRA.md, CLAUDE.md, a subfolder's, what they import)
  guides?: string[];
  skipped: { path: string; reason: WorkspaceSkipReason }[];
  tokens: number;
  budget: number;
  // The reply used all the requests it may make
  maxed?: boolean;
  // Stopped because its rounds kept bringing nothing new
  stuck?: boolean;
  // How many times earlier results were removed to make room while it explored
  compactions?: number;
};

// What changes from one version of a reply to the next
// Everything a reply did, with its cards: each version keeps its own (VERSION_FIELDS in replyVersions.ts lists them)
export type ReplyVersion = Pick<
  Message,
  | "content"
  | "model"
  | "modelId"
  | "attachments"
  | "usage"
  | "stats"
  | "webSearch"
  | "reasoning"
  | "skillsUsed"
  | "memoriesSaved"
  | "workspaceConsult"
  | "workspaceChanges"
  | "sheetVersions"
  | "commands"
  | "commitProposal"
  | "browser"
  | "screen"
  | "toolCalls"
  | "transcripts"
>;

// durationMs is set once the model stops thinking
// durationMs: what it thought so far. thinkingSince: while it thinks again (after a command, say), when that started
export type Reasoning = { text: string; durationMs?: number; thinkingSince?: number };

// Tokens the model wrote and wall-clock time from sending until the reply finished
export type ReplyStats = {
  outputTokens: number;
  durationMs: number;
};

// How much of the model's context window the conversation filled after this reply
type ContextUsage = {
  used: number;
  limit?: number;
};

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
};

// The model gets this text instead of the earlier messages; the UI still shows them
export type ConversationSummary = {
  text: string;
  // First message sent to the model verbatim after the summary
  fromIndex: number;
};

export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  summary?: ConversationSummary;
  // Never saved nor listed in the sidebar, and discarded as soon as another conversation is opened
  isPrivate?: boolean;
  // Private, and only the model and the files: Nyra adds nothing of the user's nor any of its functions (search,
  // skills, folder, commands, browser, MCP). Always with isPrivate.
  isIsolated?: boolean;
  // Names of the skills active in this conversation; their instructions go to the model with every message
  skills?: string[];
  // Shown in its own section at the top of the sidebar; stored apart from the messages
  pinned?: boolean;
  // A conversation is in one folder at most; null or missing means the general list
  folderId?: string | null;
  // The folder of the user's computer connected to it (not to confuse with folderId, a sidebar folder)
  workspace?: WorkspaceFolder;
  // In the Código space, inside this project; its workspace is the project's folder and never changes
  projectId?: string | null;
  // The skill of the task the conversation was started for (a home's card): every message goes with it in full until
  // the user removes it
  taskSkill?: string;
  // With «Automático»: moved to the model for demanding tasks for good, or kept on the main one because the user said
  // so when asked
  modelChoice?: "demanding" | "main";
};

export type Model = {
  id: string;
  name: string;
  description: string;
  providerId: string;
  supportsImages?: boolean;
  // Takes files such as PDFs directly, when the provider says (Nyra still sends them as text and page images)
  readsFiles?: boolean;
  contextWindow?: number;
  // Longest reply the model can write, when the provider says (Claude needs it for every request)
  maxOutputTokens?: number;
  // Reasons before answering, and the provider can send that reasoning apart from the reply
  thinks?: boolean;
};

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  // Tokens the model loads as context; undefined lets the provider decide
  contextLength?: number;
  // false asks a thinking model to answer straight away, for text that needs no reasoning (summaries, titles)
  reasoning?: boolean;
};

// Everything the user configures for a provider, as the settings screen and the chat see it
export type ProviderOptions = ProviderConfig & {
  autoSummarize: boolean;
  // Keep the API key between sessions (keychain or protected file); otherwise it lives only in memory
  rememberApiKey: boolean;
};
