import type { IndexedFile, MeaningMatch, OutlineOutcome, SearchOutcome, TextReadOutcome } from "./workspaceStorage";
import type { Attachment, Message, PdfVisual, WorkspaceConsult, WorkspaceSkipReason } from "@/shared/types";
import type { WorkspaceRequest } from "@/features/chat/reply/replyTags";
import { errorMessage } from "@/shared/lib/errors";
import { withSecretsHidden } from "@/features/sensitive-data/sensitiveData";
import { estimateTextTokens, estimateTokens, TOKENS_PER_IMAGE } from "@/features/chat/reply/summary";
import { asAttribute, neutralizeAppTags } from "@/features/chat/reply/appTags";
import {
  type WorkspaceChanges,
  indexText,
  MAX_FILE_TOKENS,
  MAX_WORKSPACE_STEPS,
  parseReadRequest,
  SKIP_REASON_FOR_MODEL,
  workspaceResultsMessage,
} from "./workspace";
import { fileName } from "@/shared/lib/paths";
import { foldersAbove, type GuideFile, subfolderGuidesNote } from "./projectGuides";

const LIST_MAX_TOKENS = 3000;
// One round of results can't take more than this share of the room, so a batch of large files doesn't fill it
const ROUND_SHARE = 0.4;
// Earlier results give way once the exploration fills this share of its room, down to the second
const COMPACT_AT = 0.9;
const COMPACT_TO = 0.6;
// The plan shown in the "Escribiendo…" card, in one line
const NOTE_PREVIEW_CHARS = 160;
// Pictures of one PDF read (scanned pages, figures); the model asks for the next pages by their lines
const MAX_VISUALS_PER_READ = 6;
// A fragment found by meaning is about 40 lines; this keeps one search from taking the round
const FIND_FRAGMENT_TOKENS = 900;
// A search with more matches than this says little ("http://", "password"): a few are shown with where most of them
// are, and the model is told to search for something more specific
const BROAD_SEARCH_MATCHES = 100;
const BROAD_SEARCH_SHOWN = 15;
const BROAD_SEARCH_FILES = 10;
// Lines of matches one search may take, so a search can't fill the round
const SEARCH_MAX_TOKENS = 3000;
// Rounds in a row that bring nothing new (what it already had, files that don't exist) before the model is warned,
// and before it may not ask any more and answers with what it has
const STALE_ROUNDS_WARNING = 2;
export const STALE_WARNING =
  "Your last rounds brought nothing new: you asked for what you already have or for paths that don't exist. " +
  "Ask for something different, or answer now with what you found.";
const STALE_ROUNDS_STOP = 3;

// What the "Escribiendo…" card shows while a reply looks at the folder; never stored. error: why it couldn't be done
export type WorkspaceStep = { done: boolean; error?: string } & (
  | { kind: "changes"; changes: WorkspaceChanges | null }
  | { kind: "changedSinceRead"; path: string }
  | { kind: "note"; text: string }
  | { kind: "list"; folder: string; count?: number }
  | { kind: "outline"; folder: string; count?: number; files?: number }
  | { kind: "grep"; query: string; total?: number; files?: number }
  | { kind: "find"; query: string; total?: number; files?: number }
  | {
      kind: "read";
      path: string;
      lines?: { from: number; to: number; total: number };
      size?: number;
      // Not in the index, read because it was asked for by its path
      ignored?: boolean;
      // Values of secrets hidden from the model
      hiddenSecrets?: number;
    }
  | { kind: "skipped"; path: string; reason: WorkspaceSkipReason }
  | { kind: "compacted"; count: number }
  // A command that ran in the folder, and the parts of its output the model read or searched
  | { kind: "command"; command: string; lines?: number }
  | { kind: "outputRead"; command: string; from: number; to: number }
  | { kind: "outputSearch"; command: string; query: string; total?: number }
);

type Options = {
  name: string;
  root: string;
  files: IndexedFile[];
  // Tokens the reply's exploration has, once the conversation and the rest are in
  budget: number;
  read: (path: string, from?: number, to?: number) => Promise<TextReadOutcome>;
  search: (query: string) => Promise<SearchOutcome>;
  outline: (folder: string) => Promise<OutlineOutcome>;
  // Search by meaning, when the folder's vectors are ready
  find?: (query: string) => Promise<MeaningMatch[]>;
  onSteps: (steps: WorkspaceStep[]) => void;
  // Shown first: what changed in the folder since the last message, and files read before that changed
  firstSteps?: WorkspaceStep[];
  // The project's instructions: those the model already has, and how to read a subfolder's own
  guides?: { followed: string[]; inFolder: (directory: string) => Promise<GuideFile[]> };
};

// The lines of a file that fit, numbered as in an editor ("12 | code"), so the model can cite them and ask for a
// range; it is told how to ask for the rest
function numberedLines(content: string, firstLine: number, maxTokens: number) {
  const lines = content.split("\n");
  const width = String(firstLine + lines.length - 1).length;
  const out: string[] = [];
  let tokens = 0;
  for (const [i, line] of lines.entries()) {
    const numbered = `${String(firstLine + i).padStart(width)} | ${line}`;
    const cost = estimateTextTokens(`${numbered}\n`);
    if (tokens + cost > maxTokens && out.length > 0) break;
    tokens += cost;
    out.push(numbered);
  }
  return { text: out.join("\n"), count: out.length };
}

// The pictures of the pages read, for the lines shown: a page counts if any of its lines is in
function visualsIn(pdf: { pageStarts: number[]; visuals: PdfVisual[] }, from: number, to: number, totalLines: number) {
  const lastLine = (page: number) => (pdf.pageStarts[page] ?? totalLines + 1) - 1;
  return pdf.visuals.filter((v) => pdf.pageStarts[v.page - 1] <= to && lastLine(v.page) >= from);
}

const tokensOf = (messages: Message[]) => estimateTokens(messages);

// How many of the matches are in each file, for the card and the list of what it looked at
function countByPath(matches: { path: string }[]) {
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m.path, (counts.get(m.path) ?? 0) + 1);
  return counts;
}

// The first lines that fit in maxTokens, at least one
function fittingLines(lines: string[], maxTokens: number) {
  const out: string[] = [];
  let tokens = 0;
  for (const line of lines) {
    const cost = estimateTextTokens(`${line}\n`);
    if (tokens + cost > maxTokens && out.length > 0) break;
    tokens += cost;
    out.push(line);
  }
  return out;
}

// Runs what the model asks of the folder during one reply and keeps the list of what it looked at (never the
// content). There is no reading budget: when the exploration nears the room it has, the oldest results
// are replaced by a line saying what they were, and the model's own notes keep what it learned from them.
export function workspaceTools(options: Options) {
  const { name, root, files, budget, read, search, outline, find, onSteps, firstSteps = [], guides } = options;
  const consult: WorkspaceConsult = {
    folder: name,
    root,
    read: [],
    searches: [],
    listed: [],
    outlined: [],
    skipped: [],
    tokens: 0,
    budget,
    ...(guides?.followed.length && { guides: [...guides.followed] }),
  };
  const steps: WorkspaceStep[] = [...firstSteps];
  // Subfolders whose own instructions were looked for in this reply, found or not
  const guideFolders = new Set<string>();
  const modifiedOf = new Map(files.map((f) => [f.path, f.modified]));
  // What each results turn was about, for the line that replaces it when it is compacted
  const summaries = new Map<Message, string[]>();
  let requests = 0;
  let roundLeft = 0;
  const asked = new Set<string>();
  let staleRounds = 0;
  let isStuck = false;
  // Files read with something in them, to tell a read that brought something from one that found nothing
  let freshReads = 0;
  // Pictures of PDFs read in this round, sent with its results
  let roundVisuals: { path: string; visual: PdfVisual; isImage: boolean }[] = [];
  const show = () => onSteps(steps.map((s) => ({ ...s })));
  // The check of the folder is done: from here on the wait is the model reading the request and thinking
  if (steps.length > 0) show();

  function begin(step: WorkspaceStep) {
    steps.push(step);
    show();
    return steps.length - 1;
  }
  function finish(at: number, step: WorkspaceStep) {
    steps[at] = step;
    show();
  }
  function spend(text: string) {
    spendTokens(estimateTextTokens(text));
  }
  function spendTokens(tokens: number) {
    consult.tokens += tokens;
    roundLeft -= tokens;
  }
  // As many pictures of the pages shown as fit in the round; the model is told how to ask for the rest
  function addVisuals(path: string, visuals: PdfVisual[], pageStarts: number[], isImage = false) {
    let sent = 0;
    for (const visual of visuals) {
      if (sent >= MAX_VISUALS_PER_READ || roundLeft < TOKENS_PER_IMAGE) break;
      roundVisuals.push({ path, visual, isImage });
      spendTokens(TOKENS_PER_IMAGE);
      sent++;
    }
    const left = visuals[sent];
    return left
      ? ` The pictures from page ${left.page} on were not sent: ask for "${path}:${pageStarts[left.page - 1]}-…" to see them.`
      : "";
  }
  // The step stays in the card with what went wrong; returns the message for the model
  function failed(at: number, e: unknown) {
    const message = errorMessage(e);
    finish(at, { ...steps[at], done: true, error: message });
    return message;
  }
  // The latest read of a file replaces an earlier one in the list
  function noteRead(entry: WorkspaceConsult["read"][number]) {
    consult.read = [...consult.read.filter((r) => r.path !== entry.path), entry];
    freshReads++;
  }
  function skip(path: string, reason: WorkspaceSkipReason, at: number) {
    consult.skipped.push({ path, reason });
    finish(at, { kind: "skipped", path, reason, done: true });
    return `<file path="${asAttribute(path)}" unavailable="${SKIP_REASON_FOR_MODEL[reason]}"></file>`;
  }

  // The instructions of the subfolders a file read is in, the first time one is read there; "" if none
  async function subfolderGuides(path: string) {
    if (!guides) return "";
    const notes: string[] = [];
    for (const directory of foldersAbove(path)) {
      if (guideFolders.has(directory)) continue;
      guideFolders.add(directory);
      const found = (await guides.inFolder(directory).catch(() => [])).filter(
        (file) => !consult.guides?.includes(file.path),
      );
      if (found.length === 0) continue;
      consult.guides = [...(consult.guides ?? []), ...found.map((file) => file.path)];
      const note = subfolderGuidesNote(directory, found);
      spend(note);
      notes.push(note);
    }
    return notes.join("\n\n");
  }

  async function readFiles(value: string, done: string[]) {
    const blocks: string[] = [];
    for (const request of parseReadRequest(value)) {
      // A folder asked for as a file ("src/cl/" copied from the index) is listed instead of failing
      const folder = request.path.replace(/\/+$/, "");
      if (!modifiedOf.has(request.path) && files.some((f) => f.path.startsWith(`${folder}/`))) {
        blocks.push(list(folder, done));
        continue;
      }
      if (roundLeft < 200) {
        blocks.push(`<file path="${asAttribute(request.path)}" unavailable="not read in this round, there was too much at once: ask for it again"></file>`);
        continue;
      }
      const at = begin({ kind: "read", path: request.path, done: false });
      let outcome: TextReadOutcome;
      try {
        outcome = await read(request.path, request.from, request.to);
      } catch (e) {
        // One file that fails doesn't keep the others of the request from being read
        const message = failed(at, e);
        const reason = `it couldn't be read: ${asAttribute(message)}`;
        blocks.push(`<file path="${asAttribute(request.path)}" unavailable="${reason}"></file>`);
        continue;
      }
      if (outcome.kind === "skipped") {
        blocks.push(skip(request.path, outcome.reason, at));
        continue;
      }
      if (outcome.isImage && outcome.pictures) {
        const notSent = addVisuals(request.path, outcome.pictures.visuals, outcome.pictures.pageStarts, true);
        const block = notSent
          ? `<file path="${asAttribute(request.path)}" image="not sent: there was no room left in this round; ask for it again"></file>`
          : `<file path="${asAttribute(request.path)}" image="sent with these results"></file>`;
        blocks.push(block);
        noteRead({ path: request.path, size: outcome.size, modified: modifiedOf.get(request.path) ?? 0 });
        blocks.push(await subfolderGuides(request.path));
        done.push(`looked at the image ${request.path}`);
        finish(at, { kind: "read", path: request.path, size: outcome.size, done: true });
        continue;
      }
      // The model never gets the value of a secret, whatever file it is in: the setting's name stays, its value doesn't
      const safe = withSecretsHidden(outcome.content);
      const fitted = numberedLines(safe.text, outcome.from, Math.min(roundLeft, MAX_FILE_TOKENS));
      const lines = { from: outcome.from, to: outcome.from + fitted.count - 1, total: outcome.totalLines };
      const partial = lines.from > 1 || lines.to < lines.total;
      const rest =
        lines.to < outcome.to ? ` Cut at line ${lines.to}: ask for "${request.path}:${lines.to + 1}-…" to read on.` : "";
      const notes = [
        outcome.ignored && ' ignored="not in the index: the .gitignore leaves it out or it is a dependency"',
        safe.hidden > 0 && ` secrets-hidden="${safe.hidden}"`,
      ]
        .filter(Boolean)
        .join("");
      const block =
        `<file path="${asAttribute(request.path)}" lines="${lines.from}-${lines.to} of ${lines.total}"${notes}>\n` +
        `${neutralizeAppTags(fitted.text)}\n</file>${rest}`;
      spend(block);
      const pictures = outcome.pictures
        ? addVisuals(
            request.path,
            visualsIn(outcome.pictures, lines.from, lines.to, lines.total),
            outcome.pictures.pageStarts,
          )
        : "";
      blocks.push(block + pictures, await subfolderGuides(request.path));
      noteRead({
        path: request.path,
        size: outcome.size,
        modified: modifiedOf.get(request.path) ?? 0,
        ...(partial && { lines }),
      });
      done.push(`read ${request.path}${partial ? ` (lines ${lines.from}-${lines.to} of ${lines.total})` : ""}`);
      finish(at, {
        kind: "read",
        path: request.path,
        size: outcome.size,
        ...(partial && { lines }),
        ...(outcome.ignored && { ignored: true }),
        ...(safe.hidden > 0 && { hiddenSecrets: safe.hidden }),
        done: true,
      });
    }
    return blocks.filter(Boolean).join("\n\n");
  }

  async function grep(value: string, done: string[]) {
    const query = value.trim().slice(0, 200);
    const at = begin({ kind: "grep", query, done: false });
    const found = await search(query);
    const counts = countByPath(found.matches);
    consult.searches.push({ query, total: found.total, files: [...counts].map(([path, count]) => ({ path, count })) });
    finish(at, { kind: "grep", query, total: found.total, files: counts.size, done: true });
    const isBroad = found.total > BROAD_SEARCH_MATCHES;
    const shown = isBroad ? found.matches.slice(0, BROAD_SEARCH_SHOWN) : found.matches;
    const lines = fittingLines(
      shown.map((m) => neutralizeAppTags(`${m.path}:${m.line}: ${withSecretsHidden(m.text).text}`)),
      Math.min(roundLeft, SEARCH_MAX_TOKENS),
    );
    const mostIn = [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, BROAD_SEARCH_FILES)
      .map(([path, count]) => `${neutralizeAppTags(path)} (${count})`);
    const more = isBroad
      ? `\n(${found.total} matches in ${counts.size}${found.truncated ? "+" : ""} files: too broad to be useful. Most ` +
        `are in: ${mostIn.join(", ")}. Search for something more specific, like a function name or a whole phrase.)`
      : lines.length < found.matches.length || found.truncated
        ? `\n(${found.total} matches in all; only the first ones are shown)`
        : "";
    const body =
      found.total === 0
        ? `<search query="${asAttribute(query)}">No matches.</search>`
        : `<search query="${asAttribute(query)}" matches="${found.total}">\n${lines.join("\n")}${more}\n</search>`;
    spend(body);
    done.push(`searched "${query}" (${found.total} matches)`);
    return body;
  }

  // The fragments closest in meaning, with their line numbers so the model can cite them or read around them
  async function findByMeaning(value: string, done: string[]) {
    const query = value.trim().slice(0, 300);
    if (!find) {
      return (
        `<meaning-results query="${asAttribute(query)}">Searching by meaning isn't available for this folder: ` +
        "use <nyra-grep> with the words the code would contain.</meaning-results>"
      );
    }
    const at = begin({ kind: "find", query, done: false });
    const found = await find(query);
    const counts = countByPath(found);
    consult.searches.push({
      query,
      total: found.length,
      files: [...counts].map(([path, count]) => ({ path, count })),
      byMeaning: true,
    });
    finish(at, { kind: "find", query, total: found.length, files: counts.size, done: true });
    done.push(`searched by meaning "${query}"`);
    if (found.length === 0) {
      return `<meaning-results query="${asAttribute(query)}">Nothing close in meaning.</meaning-results>`;
    }
    const blocks: string[] = [];
    for (const m of found) {
      if (roundLeft < 200) break;
      const fitted = numberedLines(withSecretsHidden(m.text).text, m.startLine, Math.min(roundLeft, FIND_FRAGMENT_TOKENS));
      const block =
        `<meaning-fragment path="${asAttribute(m.path)}" lines="${m.startLine}-${m.startLine + fitted.count - 1}">\n` +
        `${neutralizeAppTags(fitted.text)}\n</meaning-fragment>`;
      spend(block);
      blocks.push(block);
    }
    return `<meaning-results query="${asAttribute(query)}">\n${blocks.join("\n")}\n</meaning-results>`;
  }

  async function outlineOf(value: string, done: string[]) {
    const folder = value.trim().replace(/^\.\/|\/+$/g, "");
    const at = begin({ kind: "outline", folder, done: false });
    const found = await outline(folder);
    consult.outlined = [...(consult.outlined ?? []), folder];
    finish(at, { kind: "outline", folder, count: found.entries.length, files: found.files, done: true });
    // Grouped by file, so the path isn't repeated on every line
    const lines: string[] = [];
    let current = "";
    for (const entry of found.entries) {
      if (entry.path !== current) {
        current = entry.path;
        lines.push(neutralizeAppTags(entry.path));
      }
      // A definition can hold a value (export const KEY = "…"): its secrets are hidden, as in a file read
      lines.push(`  ${entry.line}: ${neutralizeAppTags(withSecretsHidden(entry.text).text)}`);
    }
    const more = found.truncated ? "\n(cut: outline a smaller folder to see the rest)" : "";
    const body =
      found.files === 0
        ? `<outline path="${asAttribute(folder)}">There is no folder or file with that path in the index.</outline>`
        : `<outline path="${asAttribute(folder)}" files="${found.files}">\n${lines.join("\n")}${more}\n</outline>`;
    spend(body);
    done.push(`outlined ${folder || "the folder"}`);
    return body;
  }

  function list(value: string, done: string[]) {
    const folder = value.trim().replace(/^\.\/|\/+$/g, "");
    const at = begin({ kind: "list", folder, done: false });
    const inside = files.filter((f) => f.path.startsWith(`${folder}/`));
    consult.listed.push(folder);
    finish(at, { kind: "list", folder, count: inside.length, done: true });
    const listing = indexText(inside, Math.min(roundLeft, LIST_MAX_TOKENS), folder.split("/").length);
    const body =
      inside.length === 0
        ? `<folder path="${asAttribute(folder)}">There is no folder with that path in the index.</folder>`
        : `<folder path="${asAttribute(folder)}" files="${inside.length}">\n${listing?.text ?? ""}\n</folder>`;
    spend(body);
    done.push(`listed ${folder}`);
    return body;
  }

  return {
    canAsk: () => requests < MAX_WORKSPACE_STEPS && !isStuck,
    // The files the user mentioned with @, read before the model starts as if it had asked for them: it has them
    // without a round trip, and they count in what the reply looked at. Not one of its requests.
    async preread(paths: string[]): Promise<string | null> {
      if (paths.length === 0) return null;
      roundLeft = Math.floor(budget * ROUND_SHARE);
      roundVisuals = [];
      for (const path of paths) asked.add(`read:${path.toLowerCase()}`);
      return readFiles(paths.join("\n"), []);
    },
    // Everything the model asked for in one reply, run together, and its plan shown while it works
    async run(requested: { kind: WorkspaceRequest; value: string }[], notes: string[]): Promise<Message> {
      const plan = notes.at(-1)?.replace(/\s+/g, " ");
      if (plan) begin({ kind: "note", text: plan.slice(0, NOTE_PREVIEW_CHARS), done: true });
      roundLeft = Math.floor(budget * ROUND_SHARE);
      roundVisuals = [];
      const bodies: string[] = [];
      const done: string[] = [];
      let progressed = false;
      for (const { kind, value } of requested) {
        if (requests >= MAX_WORKSPACE_STEPS) break;
        requests++;
        const key = `${kind}:${value.toLowerCase().replace(/\s+/g, " ")}`;
        const isNew = !asked.has(key);
        asked.add(key);
        const readsBefore = freshReads;
        const stepsBefore = steps.length;
        try {
          bodies.push(
            kind === "read"
              ? await readFiles(value, done)
              : kind === "grep"
                ? await grep(value, done)
                : kind === "find"
                  ? await findByMeaning(value, done)
                  : kind === "outline"
                    ? await outlineOf(value, done)
                    : list(value, done),
          );
        } catch (e) {
          // Ollama down for a search by meaning, the folder unreachable: the reply goes on without this result
          const at = steps.findIndex((step, i) => i >= stepsBefore && !step.done);
          const message = at >= 0 ? failed(at, e) : errorMessage(e);
          bodies.push(
            `<request-failed kind="${kind}" value="${asAttribute(value)}">It couldn't be done: ` +
              `${neutralizeAppTags(message)}. Try another way, or answer with what you have.</request-failed>`,
          );
          continue;
        }
        // Something it didn't have: a new search or listing, or a file that had something to read
        if (isNew && (kind !== "read" || freshReads > readsBefore)) progressed = true;
      }
      staleRounds = progressed ? 0 : staleRounds + 1;
      if (staleRounds >= STALE_ROUNDS_STOP) {
        isStuck = true;
        consult.stuck = true;
      } else if (staleRounds >= STALE_ROUNDS_WARNING) {
        bodies.push(STALE_WARNING);
      }
      consult.maxed = requests >= MAX_WORKSPACE_STEPS;
      if (roundVisuals.length > 0) {
        const listed = roundVisuals.map(
          ({ path, visual, isImage }, i) =>
            isImage
              ? `${i + 1}) ${neutralizeAppTags(path)} (an image of the folder)`
              : `${i + 1}) ${neutralizeAppTags(path)}, page ${visual.page} (${visual.kind === "page" ? "whole page" : "figure"})`,
        );
        bodies.push(`Images sent with these results, in order: ${listed.join("; ")}.`);
      }
      const results = workspaceResultsMessage(bodies.join("\n\n"), MAX_WORKSPACE_STEPS - requests);
      const attachments: Attachment[] = roundVisuals.map(({ path, visual, isImage }, i) => ({
        id: `workspace-picture-${requests}-${i}`,
        kind: "image",
        name: isImage ? path : `${path} #${visual.page}`,
        mimeType: "image/jpeg",
        data: visual.data,
      }));
      const message = attachments.length > 0 ? { ...results, attachments } : results;
      summaries.set(message, done);
      return message;
    },
    // null while there is room; otherwise the turns with the oldest results replaced, the latest always kept
    compact(turns: Message[]): Message[] | null {
      let total = tokensOf(turns);
      if (total <= budget * COMPACT_AT) return null;
      const latest = [...turns].reverse().find((m) => summaries.has(m));
      let count = 0;
      const compacted = turns.map((turn) => {
        const summary = summaries.get(turn);
        if (!summary || turn === latest || total <= budget * COMPACT_TO) return turn;
        const line: Message = {
          role: "user",
          content:
            `<folder-results compacted="true">Earlier results, removed to make room: ${summary.join("; ") || "nothing"}. ` +
            "Your notes keep what you learned from them; read a file again if you need its exact content.</folder-results>",
        };
        total -= tokensOf([turn]) - tokensOf([line]);
        summaries.delete(turn);
        count++;
        return line;
      });
      if (count === 0) return null;
      consult.compactions = (consult.compactions ?? 0) + 1;
      begin({ kind: "compacted", count, done: true });
      return compacted;
    },
    // A copy, so later steps don't change what the reply already shows
    consult: (): WorkspaceConsult => ({
      ...consult,
      read: [...consult.read],
      searches: [...consult.searches],
      listed: [...consult.listed],
      outlined: [...(consult.outlined ?? [])],
      skipped: [...consult.skipped],
    }),
    readNames: () => [...new Set(consult.read.map((r) => fileName(r.path)))],
    // For the commands, which show their steps in the same card
    begin,
    finish,
    hasConsulted: () =>
      consult.read.length +
        consult.searches.length +
        consult.listed.length +
        (consult.outlined?.length ?? 0) +
        consult.skipped.length >
      0,
  };
}
