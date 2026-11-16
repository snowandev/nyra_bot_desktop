import type { ChatUsage, Message, WebSearchRecord } from "@/shared/types";
import { throwIfStopped } from "./stopped";
import { type SearchStepProgress, withSearchInstruction } from "@/features/web/webSearchAgent";
import { webSearchRunner } from "@/features/web/webSearchRunner";
import {
  LONGEST_OPEN_TAG,
  BROWSER_REQUESTS,
  closingTag,
  type BrowserRequest,
  charsAfterLastRunTag,
  charsAfterLastWorkspaceTag,
  type CommandAsked,
  isBrowserRequest,
  isScreenAction,
  isScreenRequest,
  isRunRequest,
  isWorkspaceTag,
  readReply,
  readRunRound,
  readWorkspaceRound,
  REQUEST_KINDS,
  type RequestKind,
  requestNames,
  RUN_TAG_START,
  SCREEN_REQUESTS,
  type ScreenRequest,
  shownUpTo,
  strayClosing,
  tagged,
  withoutRequestTags,
  WORKSPACE_REQUESTS,
  type WorkspaceRequest,
} from "./replyTags";
import { MAX_SKILLS_PER_REPLY } from "@/features/skills/skills";
import { fetchPage, type WebPage, type WebSearchResult, webSearch } from "@/features/web/webSearchStorage";

type Options = {
  // One request to the model; the reply's text arrives through onToken. quickStep: the turn after one of the user's
  // mouse and keyboard actions, a step of a task the model already planned, asked without reasoning
  chat: (
    messages: Message[],
    onToken: (token: string) => void,
    signal: AbortSignal,
    quickStep?: boolean,
  ) => Promise<ChatUsage | undefined>;
  // The conversation as the model gets it, ending with the user's message
  history: Message[];
  canSearch: boolean;
  // The user asked in so many words: search before the model even answers
  forcedQuery: string | null;
  contextWindow: number | undefined;
  signal: AbortSignal;
  // The answer as it arrives; the start is held back until it's clear it isn't a search request
  onText: (text: string) => void;
  // Text already shown turned out to be a preface to a search request
  onClearText: () => void;
  onProgress: (steps: SearchStepProgress[]) => void;
  // What was searched, as soon as the answer starts, so the summary line shows while it is written
  onRecord: (record: WebSearchRecord) => void;
  // With marked skills: the model knows them only by their description and asks for one by name (<nyra-skill>);
  // this gives the turn with its instructions
  skillTurn?: (names: string[], canAskAnother: boolean) => Message;
  // «Automático»: the main model may hand the task over to the one for demanding tasks before answering
  canEscalate?: boolean;
  // With a connected folder: the model reads, searches, maps and opens folders in it, several at once and with its
  // notes; run gives the turn with all the results, and compact shrinks earlier results when space runs short
  workspace?: {
    canAsk: () => boolean;
    run: (requests: { kind: WorkspaceRequest; value: string }[], notes: string[]) => Promise<Message>;
    compact: (turns: Message[]) => Message[] | null;
    // Names of the files read in this reply, to tell an answer from an announcement of what comes next
    readNames: () => string[];
  };
  // Commands the model asks to run in a connected folder and programs it writes, each once the user approves it, and
  // reads of their output. Background ones run while the reply goes on: their results arrive when they end, and the
  // reply waits for them before it finishes.
  commands?: {
    canRun: () => boolean;
    canRunCode: () => boolean;
    canRead: () => boolean;
    run: (commands: CommandAsked[]) => Promise<Message>;
    read: (kind: "output" | "outputSearch", value: string) => Message;
    hasPending: () => boolean;
    takeFinished: () => Message | null;
    wait: (value: string) => Promise<Message>;
  };
  // The browser the model controls: run does the action, or says why it can't (no page open yet, the user closed it),
  // and gives the page afterwards. preface is the sentence it wrote before the tag, shown as what it is doing.
  browser?: {
    run: (kind: BrowserRequest, value: string, preface: string) => Promise<Message>;
  };
  // The transcript of an attached audio, made when the model asks for it
  transcription?: {
    run: (value: string) => Promise<Message>;
  };
  // The user's screen: a look at it, or a mark pointed out on it, once the user allows it for the conversation
  screen?: {
    run: (kind: ScreenRequest, value: string) => Promise<Message>;
  };
  // A tool of the user's MCP servers, once the user allows it
  tools?: {
    run: (value: string) => Promise<Message>;
  };
  // What is shown so far stays: its commands' cards sit after it, and a later clear only goes back to here
  onKeepText?: () => void;
  // The model stopped thinking: the reply waits (the user's approval, a command running) or its answer started, maybe
  // still held back
  onWaiting?: () => void;
  // Injected in tests
  search?: (query: string) => Promise<WebSearchResult[]>;
  read?: (url: string) => Promise<WebPage>;
};

// For a model that asked for more after its last allowed request and wrote nothing else
export const ANSWER_NOW: Message = {
  role: "user",
  content:
    "<app-instructions>\nYou can't look anything else up in this reply. Answer the user's message now with what you " +
    "already have, without any tag, and say briefly what you couldn't check.\n</app-instructions>",
};

// For a model that stopped without answering (everything in its reasoning or in an unfinished note) or that said what
// it would look at next without asking for it
export const KEEP_GOING: Message = {
  role: "user",
  content:
    "<app-instructions>\nYou haven't answered the user yet. If you need to look at anything else, ask for it now with " +
    "the tags. Otherwise write your full answer to the user's message now, with what you found, outside any tag.\n" +
    "</app-instructions>",
};

// For a short reply after reading the folder that names nothing it read: it may be saying what it will look at next,
// or it may be a short answer ("No, there are no tests."), so it isn't told it hasn't answered
export const ANSWER_OR_ASK: Message = {
  role: "user",
  content:
    "<app-instructions>\nIf that was your whole answer to the user, write it again as it is. If you meant to look at " +
    "something else first, ask for it now with the tags.\n</app-instructions>",
};

// For a model that answered while background commands still ran: they ended, and its answer goes on below
export const CONTINUE_AFTER_COMMANDS =
  "<app-instructions>\nThe background commands above ended while you wrote your answer. Continue your answer below, " +
  "as a new paragraph, with what their results add or change; if they change nothing, say so in one short sentence. " +
  "Don't repeat what you already wrote.\n</app-instructions>";

// Text before a request's commands with this in it holds notes or folder tags, not words for the user
const TAG_START = "<nyra-";

// For a model that wrote a tag's closing without its opening: nothing was done, and it writes its answer again
const wrongTag = (kind: RequestKind): Message => ({
  role: "user",
  content:
    `<app-instructions>\nYou wrote ${closingTag(kind)} without its opening tag, so nothing ` +
    `was done and the user saw the tag. Write your answer again; when you use a tag, write it whole, like ` +
    `${tagged(kind, "…")}.\n</app-instructions>`,
});

// Background results join the latest turn when it is the app's, so turns keep alternating
function withResults(turns: Message[], results: Message) {
  const last = turns.at(-1);
  if (last?.role === "user") turns[turns.length - 1] = { ...last, content: `${last.content}\n${results.content}` };
  else turns.push(results);
}

// Rounds a reply gets to answer after stopping short; then whatever it wrote is shown
const MAX_NUDGES = 2;

// Past this, text after the last folder tag is the model answering results it hasn't seen yet
const MAX_TEXT_AFTER_TAGS = 400;

// After reading the folder, a short reply is told by its shape, so it works in any language. One that stops on ":" or
// "…" is the model saying what comes next.
const endsOpen = (answer: string) => /(:|…|\.\.\.)$/.test(answer.trim());

// One that names none of the files it read is most likely an announcement too ("Ahora voy a revisar los componentes."),
// since a real answer about the folder names what it relies on, as it is asked to; but a short answer may not
function namesNothingRead(answer: string, readNames: string[]) {
  const lower = answer.toLowerCase();
  const names = readNames.flatMap((name) => {
    const stem = name.replace(/\.[^.]+$/, "");
    return stem.length >= 3 && stem !== name ? [name, stem] : [name];
  });
  return names.length > 0 && !names.some((name) => lower.includes(name.toLowerCase()));
}

// Longer than this, a reply is an answer; shorter ones after reading the folder are held back until they end, so one
// that turns out to be an announcement never flashes on screen
const MAX_ANNOUNCEMENT_CHARS = 400;

// While the model can still ask for something, a short start may be the sentence it writes before its tag ("Now I'll
// sign in."): held back until it is clearly the answer, so it never flashes on screen to be cleared. By length, so it
// works in any language.
const MAX_PREFACE_CHARS = 200;

// What it wrote, without its requests and with its notes as plain text: shown when nothing better came
const ASKING = requestNames(REQUEST_KINDS.filter((kind) => kind !== "note"));
const REQUEST_TAGS = new RegExp(`<nyra-(${ASKING})>[\\s\\S]*?(</nyra-\\1>|$)`, "g");
const notesAsText = (text: string) =>
  text
    .replace(REQUEST_TAGS, "")
    .replace(/<\/?nyra-note>/g, "")
    .trim();


// Answers, first searching the web when the user asked or the model decides it needs to (up to MAX_SEARCHES), and
// loading the instructions of the skills the model asks for (up to MAX_SKILLS_PER_REPLY, one or several at a time)
export async function replyWithSearch(
  options: Options,
): Promise<{ usage: ChatUsage | undefined; received: boolean; escalated?: boolean }> {
  const { chat, history, canSearch, forcedQuery, contextWindow, signal } = options;
  const { onText, onClearText, onProgress, onRecord, skillTurn, workspace, commands, onKeepText, onWaiting } = options;
  const { browser, transcription, tools, screen } = options;
  const search = options.search ?? webSearch;
  const read = options.read ?? fetchPage;

  const web = webSearchRunner({ search, read, contextWindow, signal, canSearch, onProgress });
  // The search turns the model went through: its request and the results, in order
  const turns: Message[] = [];
  // Reasoning again before each click of a task made each step take seconds more; it planned on the first turn
  let afterAction = false;
  let skillsLoaded = 0;
  let nudges = 0;
  let toldToAnswer = false;
  let askedToConfirm = false;
  let folderRounds = 0;
  // An answer already written stays above while the model continues it with background results
  let continuing = false;

  // Background commands that ended while the model answered: the answer stays and the model continues it with their
  // results. Those still running aren't waited for (a server never ends): they go on after the reply, and their
  // results reach the model with the next message. False when nothing ended.
  async function continueAfterBackground(answer: string) {
    const results = commands?.takeFinished();
    if (!results) return false;
    onKeepText?.();
    continuing = true;
    turns.push(
      { role: "assistant", content: answer },
      { ...results, content: `${results.content}\n${CONTINUE_AFTER_COMMANDS}` },
    );
    return true;
  }

  if (canSearch && forcedQuery) turns.push(...(await web.run(forcedQuery)));

  for (;;) {
    const ended = commands?.takeFinished();
    if (ended) withResults(turns, ended);
    const canUseFolder = !!workspace?.canAsk();
    const allowed: RequestKind[] = [
      ...(web.searchesLeft() > 0 ? (["search"] as const) : []),
      // Only on the first round: once it worked on the task, the main model finishes it
      ...(options.canEscalate && turns.length === 0 ? (["escalate"] as const) : []),
      ...(skillTurn && skillsLoaded < MAX_SKILLS_PER_REPLY ? (["skill"] as const) : []),
      ...(canUseFolder ? [...WORKSPACE_REQUESTS, "note" as const] : []),
      ...(commands?.canRun() ? (["run", "runBackground"] as const) : []),
      ...(commands?.canRunCode() ? (["code", "codeBackground"] as const) : []),
      ...(commands?.hasPending() ? (["wait"] as const) : []),
      ...(commands?.canRead() ? (["output", "outputSearch"] as const) : []),
      // Every browser tag is read while the reply has a browser, so one that can't be done now gets an answer saying
      // why instead of passing as text the model then takes for done
      ...(browser ? BROWSER_REQUESTS : []),
      ...(transcription ? (["transcribe"] as const) : []),
      ...(tools ? (["tool"] as const) : []),
      ...(screen ? SCREEN_REQUESTS : []),
    ];
    // The oldest folder results give way before the context fills, and the exploration goes on
    const compacted = workspace?.compact(turns);
    if (compacted) turns.splice(0, turns.length, ...compacted);
    // Until a search happens the user's message carries how to ask for one; afterwards its results say whether
    // the model may search again
    const base = web.searchesLeft() > 0 && !web.hasSearched() ? withSearchInstruction(history) : history;
    const messages = [...base, ...turns];
    const round = new AbortController();
    const stopRound = () => round.abort();
    signal.addEventListener("abort", stopRound);

    let text = "";
    let shown = 0;
    let state = readReply("", allowed);
    // Where the text not yet looked at for a tag starts: reading the whole reply on every word grew with its length
    let unread = 0;
    let answerStarted = false;
    // Answer written after notes alone, already shown while it arrived
    let shownAfterNotes = 0;
    const holdUpTo = folderRounds > 0 && workspace ? MAX_ANNOUNCEMENT_CHARS : allowed.length > 0 ? MAX_PREFACE_CHARS : 0;
    // A folder round lets the reply finish: the model may ask for several things at once and write its notes. So
    // does a request to run commands, which may list several in a row.
    const isFolderRound = () => state.kind === "request" && isWorkspaceTag(state.request);
    const isRunRound = () => state.kind === "request" && isRunRequest(state.request);
    const startAnswer = () => {
      if (answerStarted) return;
      answerStarted = true;
      onWaiting?.();
      onProgress([]);
      if (web.hasRecord()) onRecord(web.record());
    };
    const onToken = (token: string) => {
      text += token;
      if (state.kind === "request") {
        if (isFolderRound() && charsAfterLastWorkspaceTag(text) > MAX_TEXT_AFTER_TAGS) {
          const folderRound = readWorkspaceRound(text);
          const hasRuns = RUN_TAG_START.test(text);
          // A long text after requests answers results it hasn't seen; after notes alone it is the answer itself,
          // shown as it arrives and never cut, unless commands follow the notes
          if (hasRuns && charsAfterLastRunTag(text) > MAX_TEXT_AFTER_TAGS) round.abort();
          else if (!hasRuns && folderRound.requests.length > 0) round.abort();
          else if (!hasRuns) showAfterNotes(folderRound.end);
        }
        if (isRunRound() && charsAfterLastRunTag(text) > MAX_TEXT_AFTER_TAGS) round.abort();
        return;
      }
      // An answer stays one until a tag starts in the new text; the overlap keeps a tag still being written in view
      const tagMayStart = state.kind !== "answer" || text.indexOf(TAG_START, unread) !== -1;
      if (tagMayStart) state = readReply(text, allowed);
      if (state.kind === "answer") unread = Math.max(0, text.length - LONGEST_OPEN_TAG);
      if (state.kind === "request") {
        if (!isFolderRound() && !isRunRound()) round.abort();
        return;
      }
      if (state.kind !== "answer") return;
      startAnswer();
      if (text.length <= holdUpTo) return;
      // A tag being written isn't shown while it could still be a request
      const upTo = shownUpTo(text);
      if (upTo <= shown) return;
      onText(text.slice(shown, upTo));
      shown = upTo;
    };
    function showAfterNotes(notesEnd: number) {
      const answer = text.slice(notesEnd).replace(/^\s+/, "");
      const upTo = shownUpTo(answer);
      if (upTo <= shownAfterNotes) return;
      startAnswer();
      onText(answer.slice(shownAfterNotes, upTo));
      shownAfterNotes = upTo;
    }

    // What it already showed before a search or a browser action stays, and its answer goes on below; the model gets
    // it back too, so it doesn't write it again
    function keepShown() {
      if (shown > 0) onKeepText?.();
    }
    const withPreface = (request: string) =>
      state.kind === "request" && state.preface ? `${state.preface}\n${request}` : request;

    // The commands of the round, with the folder requests and notes that came along with them
    async function runCommandsRound(tools: NonNullable<Options["commands"]>) {
      const runRound = readRunRound(text);
      const before = text.slice(0, runRound.start);
      // What it wrote before its commands stays in the reply, above their cards, and what it writes next goes below.
      // Notes or folder tags before them aren't for the user.
      if (before.includes(TAG_START)) {
        // Shown so far as an answer, also what came after notes alone: it was the preface, written again below
        if (shown > 0 || shownAfterNotes > 0) onClearText();
        const visible = withoutRequestTags(before);
        if (visible) onText(`${visible}\n\n`);
      } else if (shown < runRound.start) {
        onText(text.slice(shown, runRound.start));
      }
      startAnswer();
      onKeepText?.();
      onWaiting?.();
      const result = await tools.run(runRound.commands);
      throwIfStopped(signal);
      // Asked along with the commands (a file to read while a build runs): done in the same round, not lost
      const folderRound = workspace?.canAsk() ? readWorkspaceRound(text) : null;
      if (folderRound && folderRound.requests.length > 0 && workspace) {
        folderRounds++;
        const notes = folderRound.notes.filter((note) => !RUN_TAG_START.test(note));
        const folderResult = await workspace.run(folderRound.requests, notes);
        throwIfStopped(signal);
        const end = Math.max(runRound.end, folderRound.end);
        turns.push(
          { role: "assistant", content: text.slice(0, end) },
          { role: "user", content: `${result.content}\n${folderResult.content}` },
        );
        return;
      }
      turns.push({ role: "assistant", content: text.slice(0, Math.max(runRound.end, folderRound?.end ?? 0)) }, result);
    }

    let usage: ChatUsage | undefined;
    try {
      usage = await chat(messages, onToken, round.signal, afterAction);
      afterAction = false;
    } catch (e) {
      // Cut short on purpose to search or load a skill; any other failure (or the user stopping) goes up
      if (signal.aborted || state.kind !== "request") throw e;
    } finally {
      signal.removeEventListener("abort", stopRound);
    }

    // Before answering, so nothing of the main model's work is left half done
    if (state.kind === "request" && state.request === "escalate") {
      return { usage, received: false, escalated: true };
    }
    if (state.kind === "request" && isWorkspaceTag(state.request) && workspace) {
      // Notes or reads first and commands after: the commands are asked for too, never taken for the answer
      if ((commands?.canRun() || commands?.canRunCode()) && readRunRound(text).commands.length > 0) {
        await runCommandsRound(commands);
        continue;
      }
      const folderRound = readWorkspaceRound(text);
      if (folderRound.requests.length > 0) {
        if (shown > 0 || shownAfterNotes > 0) onClearText();
        folderRounds++;
        const result = await workspace.run(folderRound.requests, folderRound.notes);
        throwIfStopped(signal);
        // What it wrote up to its last tag: its notes stay, an answer to unseen results doesn't
        turns.push({ role: "assistant", content: text.slice(0, folderRound.end) }, result);
        continue;
      }
      // Only notes: what follows them is the answer, maybe already shown in part while it arrived
      if (folderRound.rest) {
        startAnswer();
        onText(folderRound.rest.slice(shownAfterNotes));
        if (await continueAfterBackground(text)) continue;
        return { usage, received: true };
      }
    } else if (isRunRound() && commands) {
      await runCommandsRound(commands);
      continue;
    } else if (state.kind === "request" && state.request === "wait" && commands) {
      if (shown > 0) onClearText();
      onWaiting?.();
      const result = await commands.wait(state.value);
      throwIfStopped(signal);
      turns.push({ role: "assistant", content: tagged("wait", state.value) }, result);
      continue;
    } else if (state.kind === "request" && (state.request === "output" || state.request === "outputSearch") && commands) {
      if (shown > 0) onClearText();
      turns.push({ role: "assistant", content: tagged(state.request, state.value) }, commands.read(state.request, state.value));
      continue;
    } else if (state.kind === "request" && isBrowserRequest(state.request) && browser) {
      keepShown();
      onWaiting?.();
      const result = await browser.run(state.request, state.value, state.preface);
      throwIfStopped(signal);
      turns.push({ role: "assistant", content: withPreface(tagged(state.request, state.value)) }, result);
      continue;
    } else if (state.kind === "request" && state.request === "tool" && tools) {
      keepShown();
      onWaiting?.();
      const result = await tools.run(state.value);
      throwIfStopped(signal);
      turns.push({ role: "assistant", content: withPreface(tagged("tool", state.value)) }, result);
      continue;
    } else if (state.kind === "request" && isScreenRequest(state.request) && screen) {
      keepShown();
      onWaiting?.();
      const result = await screen.run(state.request, state.value);
      throwIfStopped(signal);
      afterAction = isScreenAction(state.request);
      turns.push({ role: "assistant", content: withPreface(tagged(state.request, state.value)) }, result);
      continue;
    } else if (state.kind === "request" && state.request === "transcribe" && transcription) {
      keepShown();
      onWaiting?.();
      const result = await transcription.run(state.value);
      throwIfStopped(signal);
      turns.push({ role: "assistant", content: withPreface(tagged("transcribe", state.value)) }, result);
      continue;
    } else if (state.kind === "request" && state.request === "search") {
      keepShown();
      const [asked, ...results] = await web.run(state.value);
      turns.push(...(asked ? [{ ...asked, content: withPreface(asked.content) }, ...results] : results));
      continue;
    } else if (state.kind === "request") {
      if (shown > 0) onClearText();
      if (state.request === "skill" && skillTurn) {
        // Several at once save a round trip: "summarize, plan"
        const names = [...new Set(state.value.split(",").map((n) => n.trim()))]
          .filter(Boolean)
          .slice(0, MAX_SKILLS_PER_REPLY - skillsLoaded);
        skillsLoaded += Math.max(names.length, 1);
        const canAskAnother = skillsLoaded < MAX_SKILLS_PER_REPLY;
        turns.push({ role: "assistant", content: tagged("skill", names.join(", ")) }, skillTurn(names, canAskAnother));
      }
      continue;
    }

    // It stopped without an answer: everything went into its reasoning, into notes (closed or not), or into a request
    // it can no longer make. Or, after reading the folder, it only said what it would look at next.
    // Without search, skills or a folder a tag is just text the model wrote
    const couldAsk =
      canSearch || !!skillTurn || !!workspace || !!commands || !!browser || !!transcription || !!tools || !!screen;
    const answer = withoutRequestTags(text);
    const unanswered = couldAsk && !answer && (turns.length > 0 || text.trim() !== "");
    const short = folderRounds > 0 && !!answer && answer.length <= MAX_ANNOUNCEMENT_CHARS && !!workspace?.canAsk();
    const announced = short && endsOpen(answer);
    // Asked once: if it writes a short answer again, that is its answer
    const maybeAnnounced: boolean =
      short && !announced && !askedToConfirm && namesNothingRead(answer, workspace?.readNames() ?? []);
    // A request written wrong (its closing tag alone) did nothing: the model is told, by the tag's shape
    const malformed = state.kind === "answer" ? strayClosing(text, allowed) : null;
    // Answering now is the last thing it is told
    if (
      (unanswered || announced || maybeAnnounced || malformed) &&
      nudges < MAX_NUDGES &&
      !toldToAnswer &&
      !continuing
    ) {
      nudges++;
      if (shown > 0) onClearText();
      if (text.trim()) turns.push({ role: "assistant", content: text });
      toldToAnswer = allowed.length === 0 || nudges === MAX_NUDGES;
      askedToConfirm ||= maybeAnnounced;
      turns.push(
        toldToAnswer ? ANSWER_NOW : malformed ? wrongTag(malformed) : maybeAnnounced ? ANSWER_OR_ASK : KEEP_GOING,
      );
      continue;
    }
    // A short answer held back while it could still be an announcement
    if (state.kind === "answer" && shown < text.length) {
      onText(text.slice(shown));
      shown = text.length;
    }
    if (await continueAfterBackground(text)) continue;
    // Still no answer after asking: its latest notes in this reply are better than nothing
    const lastNotes =
      notesAsText(text) ||
      [...turns]
        .reverse()
        .filter((turn) => turn.role === "assistant")
        .map((turn) => notesAsText(turn.content))
        .find(Boolean);
    if (shown === 0 && lastNotes) {
      onText(lastNotes);
      shown = lastNotes.length;
    }
    if (!answerStarted && web.hasRecord()) onRecord(web.record());
    onProgress([]);
    return { usage, received: shown > 0 || continuing };
  }
}
