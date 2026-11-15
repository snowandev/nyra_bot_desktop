import { putById } from "@/shared/lib/byId";
import type { CodeLanguage, CommandRun, Message } from "@/shared/types";
import { errorMessage } from "@/shared/lib/errors";
import { formatDuration } from "@/shared/lib/format";
import { type CommandAsked, tagged } from "@/features/chat/reply/replyTags";
import { i18n } from "@/shared/i18n/i18n";
import { withSecretsHidden } from "@/features/sensitive-data/sensitiveData";
import { asAttribute, neutralizeAppTags } from "@/features/chat/reply/appTags";
import { shortened } from "@/shared/lib/format";
import type { WorkspaceStep } from "@/features/workspace/workspaceTools";
import {
  appendOutput,
  keepWithin,
  LIVE_SLACK_LINES,
  MAX_KEPT_LINES,
  MAX_READ_LINES,
  newlinesIn,
  outputRange,
  outputTail,
  searchOutput,
  totalLines,
} from "./outputText";
import { ended, keepRunning, waitForDecision, wasStopped } from "./commandControl";
import { commandInputHidden, runCommand, stopCommand } from "./terminalStorage";
import { codeFiles, codeSpace, prepareCode } from "./codeStorage";
import { isCodeLanguage, LISTED_FILES, runLabel } from "./programs";

// Requests to run commands in one reply, and reads of their output, so a model can't loop on them forever
const MAX_COMMAND_REQUESTS = 20;
const MAX_OUTPUT_READS = 30;
// Running in the background at once, so several builds don't swamp the computer; more wait their turn like any other
export const MAX_IN_BACKGROUND = 3;
// A command that printed a line without ending it and then went quiet this long is asking something
const QUESTION_AFTER_MS = 700;
const QUESTION_CHECK_MS = 300;
// What later messages carry of what the user wrote instead of running a command
const MAX_ANSWER_NOTE = 300;

export type CodeOptions = {
  conversationId: string;
  dir: string;
  label: string;
  languages: CodeLanguage[];
  packages: string[];
  missingPackages: string[];
  // The attached files' names in its folder
  files: string[];
  inputs: () => { name: string; data: string }[];
};

type Options = {
  conversationId: string;
  // The connected folder: commands run in it, and so do programs when there is one
  folder: { root: string; name: string } | null;
  // Commands may run in the folder (with programs alone, only programs)
  allowCommands: boolean;
  // Programs, when this computer can run some: the conversation's own folder, its attached files and the languages
  code: CodeOptions | null;
  // Where the cards go: the reply's text so far
  offset: () => number;
  // Writes the reply's commands as they change
  update: (change: (runs: CommandRun[]) => CommandRun[]) => void;
  // After the reply ended, for a program left running: writes it in the message that holds it, wherever it is by then
  writeAfter: (run: CommandRun) => void;
  // The "Escribiendo…" card of the folder
  steps: { begin: (step: WorkspaceStep) => number; finish: (at: number, step: WorkspaceStep) => void };
  signal: AbortSignal;
  // The reply is stopped until the user acts: a command to approve (with how many wait in its request) or a question
  onNeedsYou?: (need: CommandNeed, count: number) => void;
};

export type CommandNeed = "approval" | "question";

const newId = () => `cmd-${crypto.randomUUID()}`;

const isRunning = (run: CommandRun) => run.state === "running" || run.state === "asking";

function resultFor(run: CommandRun, codeDir?: string) {
  const attributes = [
    `n="${run.n}"`,
    run.code ? `program="${run.code.language}"` : `command="${asAttribute(run.command)}"`,
    run.edited && 'edited-by-user="true"',
  ].filter(Boolean);
  if (run.state === "rejected") {
    const why = run.answer ? "the user wrote to you instead of running it" : "the user chose not to run it";
    return `<command-result ${attributes.join(" ")} not-run="${why}"></command-result>`;
  }
  if (run.state === "queued") {
    return `<command-result ${attributes.join(" ")} not-run="an earlier command of the request didn't run"></command-result>`;
  }
  if (run.state === "running" || run.state === "asking") {
    return (
      `<command-result ${attributes.join(" ")} running-in-background="true">It started. Its result comes in a later ` +
      `turn when it ends; meanwhile go on with what doesn't need it, or wait for it with ${tagged("wait", String(run.n))}.` +
      "</command-result>"
    );
  }
  const output = run.output ?? "";
  const tail = outputTail(withSecretsHidden(output).text);
  const ending =
    run.state === "stopped"
      ? `stopped="the user stopped it after ${formatDuration(run.durationMs ?? 0)}"`
      : run.exitCode === undefined
        ? `error="it couldn't run"`
        : `exit-code="${run.exitCode}"`;
  const more =
    tail.from > 1
      ? `(lines ${tail.from}-${tail.total} of ${tail.total}; read earlier ones with ${tagged("output", `${run.n} 1-${MAX_READ_LINES}`)} ` +
        `or search them with ${tagged("outputSearch", `${run.n} text`)})\n`
      : "";
  const created = run.files?.length
    ? `\nFiles it created or changed in "${codeDir ?? ""}": ${run.files
        .slice(0, LISTED_FILES)
        .map((f) => asAttribute(f.path))
        .join(", ")}${run.files.length > LISTED_FILES ? ` and ${run.files.length - LISTED_FILES} more` : ""}.`
    : "";
  const body = (output.trim() ? `${more}${neutralizeAppTags(tail.text)}` : "(it printed nothing)") + created;
  return (
    `<command-result ${attributes.join(" ")} ${ending} duration="${formatDuration(run.durationMs ?? 0)}" ` +
    `lines="${tail.total}">\n${body}\n</command-result>`
  );
}

// Runs the commands the model asks for in one reply, once the user approves each, and keeps them with the reply
export function commandTools(options: Options) {
  const { conversationId, folder, allowCommands, code, offset, update, writeAfter, steps, signal, onNeedsYou } = options;
  const runs: CommandRun[] = [];
  const root = folder?.root ?? code?.dir ?? "";
  // The attached files go to the conversation's folder the first time a program needs them
  let inputsReady: Promise<unknown> | null = null;
  // Their names: written right before a program runs, they aren't what it created
  const inputNames = new Set<string>();
  let requests = 0;
  let reads = 0;
  // Output arrives faster than the screen refreshes; the card gets it at most once per frame
  const dirty = new Set<string>();
  let frame = 0;
  // Once the reply has ended its message is settled: a late write would land on whatever message is last by then.
  // Programs left running write to their own message instead.
  let closed = false;

  function write(run: CommandRun) {
    if (closed) {
      if (run.detached) writeAfter({ ...run });
      return;
    }
    update((all) => putById(all, { ...run }));
  }
  function set(run: CommandRun, change: Partial<CommandRun>) {
    Object.assign(run, change);
    write(run);
  }
  function writeSoon(run: CommandRun) {
    dirty.add(run.id);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const id of dirty) {
        const found = runs.find((r) => r.id === id);
        if (found) write(found);
      }
      dirty.clear();
    });
  }

  // Saved in the conversation's folder and run by its interpreter; false when it couldn't even be saved
  async function prepareProgram(run: CommandRun) {
    if (!code || !run.code || !isCodeLanguage(run.code.language)) return false;
    try {
      if (!inputsReady) {
        const inputs = code.inputs();
        inputs.forEach((input) => inputNames.add(input.name));
        inputsReady = codeSpace(code.conversationId, inputs);
      }
      await inputsReady;
      set(run, { command: await prepareCode(code.conversationId, run.code.language, run.code.source) });
      return true;
    } catch (e) {
      inputsReady = null;
      const note = i18n.t("terminal.couldNotRun", { error: errorMessage(e) });
      set(run, { state: "failed", output: note, lines: 1, durationMs: 0 });
      return false;
    }
  }

  // What the program left in the conversation's folder: anything new or changed since it started
  async function noteCreated(run: CommandRun) {
    if (!code || !run.code || !run.startedAt) return;
    const since = run.startedAt - 1000;
    const changed = await codeFiles(code.conversationId).catch(() => []);
    const files = changed
      .filter((f) => f.modified >= since && !inputNames.has(f.path))
      .map(({ path, size }) => ({ path, size }));
    if (files.length > 0) set(run, { files });
  }

  async function execute(run: CommandRun) {
    const stepAt = steps.begin({ kind: "command", command: runLabel(run), done: false });
    const startedAt = Date.now();
    set(run, { state: "running", startedAt, output: "" });
    let output = "";
    // Lines in output so far, and those that went from its middle while it ran
    let lines = 0;
    let dropped = 0;
    let lastOutputAt = startedAt;
    let checking = false;
    // A program that shows progress without ending its line can look like a question several times: one notice
    let toldAboutQuestion = false;
    // Programs ask by printing a line without ending it and waiting: told by its shape, whatever its language
    const watch = window.setInterval(() => {
      const waits = output !== "" && !output.endsWith("\n") && Date.now() - lastOutputAt > QUESTION_AFTER_MS;
      if (!waits || run.state !== "running" || checking) return;
      checking = true;
      commandInputHidden(run.id)
        .then((hidden) => {
          if (run.state !== "running" || Date.now() - lastOutputAt <= QUESTION_AFTER_MS) return;
          set(run, { state: "asking", hiddenInput: hidden });
          if (!toldAboutQuestion) onNeedsYou?.("question", 1);
          toldAboutQuestion = true;
        })
        .catch(() => {})
        .finally(() => (checking = false));
    }, QUESTION_CHECK_MS);
    const stopOnAbort = () => void stopCommand(run.id).catch(() => {});
    signal.addEventListener("abort", stopOnAbort);
    try {
      const exitCode = await runCommand(run.id, root, run.command, (chunk) => {
        output = appendOutput(output, chunk);
        lines += newlinesIn(chunk);
        // A chatty command can't fill the memory while it runs: the middle goes as it would once it ends
        if (lines > MAX_KEPT_LINES + LIVE_SLACK_LINES) {
          ({ output, dropped } = keepWithin(output, dropped));
          lines = MAX_KEPT_LINES;
        }
        lastOutputAt = Date.now();
        run.output = output;
        run.lines = lines + dropped;
        // Anything after the answer means it went on
        if (run.state === "asking") set(run, { state: "running", hiddenInput: false });
        else writeSoon(run);
      });
      const stopped = wasStopped(run.id) || signal.aborted;
      const kept = keepWithin(output, dropped);
      set(run, {
        state: stopped ? "stopped" : exitCode === 0 ? "done" : "failed",
        exitCode,
        durationMs: Date.now() - startedAt,
        output: kept.output,
        lines: totalLines(kept.output, kept.dropped),
        hiddenInput: false,
      });
    } catch (e) {
      wasStopped(run.id);
      const note = i18n.t("terminal.couldNotRun", { error: errorMessage(e) });
      set(run, {
        state: "failed",
        durationMs: Date.now() - startedAt,
        output: output ? appendOutput(keepWithin(output, dropped).output, `\n${note}`) : note,
        lines: totalLines(output, dropped) + 1,
      });
    } finally {
      window.clearInterval(watch);
      signal.removeEventListener("abort", stopOnAbort);
    }
    await noteCreated(run);
    if (run.detached) ended(conversationId, run.id);
    steps.finish(stepAt, { kind: "command", command: runLabel(run), lines: run.lines, done: true });
  }

  // Background commands by number: how they end, and whether the model already has their result
  const inBackground = new Map<number, Promise<void>>();
  const delivered = new Set<number>();
  const runningInBackground = () => runs.filter((r) => inBackground.has(r.n) && isRunning(r)).length;
  const finishedInBackground = () =>
    runs.filter((r) => inBackground.has(r.n) && !delivered.has(r.n) && !isRunning(r));

  function resultsOf(ended: CommandRun[]): Message {
    ended.forEach((run) => delivered.add(run.n));
    return { role: "user", content: `<command-results>\n${ended.map((r) => resultFor(r, code?.dir)).join("\n")}\n</command-results>` };
  }

  function find(n: number) {
    return runs.find((r) => r.n === n && r.output !== undefined);
  }

  function readRange(value: string) {
    const match = value.trim().match(/^#?(\d+)\s*:?\s*(\d+)\s*[-–]\s*(\d+)$/);
    const run = match && find(Number(match[1]));
    if (!match || !run) {
      return `<command-output value="${asAttribute(value)}">Write the command's number and a range, like ${tagged("output", "1 120-300")}, for a command that ran in this reply.</command-output>`;
    }
    const range = outputRange(withSecretsHidden(run.output ?? "").text, Number(match[2]), Number(match[3]));
    const stepAt = steps.begin({ kind: "outputRead", command: run.command, from: range.from, to: range.to, done: false });
    set(run, { reads: [...(run.reads ?? []), { from: range.from, to: range.to }] });
    steps.finish(stepAt, { kind: "outputRead", command: run.command, from: range.from, to: range.to, done: true });
    return (
      `<command-output n="${run.n}" lines="${range.from}-${range.to} of ${range.total}">\n` +
      `${neutralizeAppTags(range.text)}\n</command-output>`
    );
  }

  function search(value: string) {
    const match = value.trim().match(/^#?(\d+)\s*:?\s+([\s\S]+)$/);
    const run = match && find(Number(match[1]));
    if (!match || !run) {
      return `<command-search value="${asAttribute(value)}">Write the command's number and the text, like ${tagged("outputSearch", "1 warning")}, for a command that ran in this reply.</command-search>`;
    }
    const query = match[2].trim().slice(0, 200);
    const stepAt = steps.begin({ kind: "outputSearch", command: run.command, query, done: false });
    const found = searchOutput(withSecretsHidden(run.output ?? "").text, query);
    steps.finish(stepAt, { kind: "outputSearch", command: run.command, query, total: found.total, done: true });
    if (found.total === 0) return `<command-search n="${run.n}" query="${asAttribute(query)}">No lines with it.</command-search>`;
    const more = found.shown < found.total ? `\n(${found.total} lines in all; only the first ones are shown)` : "";
    return (
      `<command-search n="${run.n}" query="${asAttribute(query)}" matches="${found.total}">\n` +
      `${neutralizeAppTags(found.text)}${more}\n</command-search>`
    );
  }

  return {
    canRun: () => allowCommands && requests < MAX_COMMAND_REQUESTS && !signal.aborted,
    canRunCode: () => !!code && requests < MAX_COMMAND_REQUESTS && !signal.aborted,
    // Some still running in the background, or ended without the model having their result
    hasPending: () => [...inBackground.keys()].some((n) => !delivered.has(n)),
    canRead: () => reads < MAX_OUTPUT_READS && runs.some((r) => r.output !== undefined),

    // One request: its commands wait in order, each runs only once approved, and a rejected or stopped one leaves
    // the rest unrun. One in the background starts and the next one comes at once. Resolves with the turn holding
    // their results, or saying which ones went on in the background.
    async run(commands: CommandAsked[]): Promise<Message> {
      requests++;
      const at = offset();
      const batch = commands.slice(0, MAX_COMMAND_REQUESTS).map(
        ({ command, background, code: program }, i): CommandRun => ({
          id: newId(),
          command,
          root,
          folder: folder?.name ?? code?.label ?? "",
          at,
          n: runs.length + i + 1,
          state: i === 0 ? "pending" : "queued",
          ...(background && { background: true }),
          ...(program &&
            code && { code: { language: program.language, source: program.source, conversationId: code.conversationId } }),
        }),
      );
      runs.push(...batch);
      batch.forEach(write);
      for (const [i, run] of batch.entries()) {
        // A program in a language this computer can't run, or a command where commands aren't allowed, never waits
        const unrunnable = run.code
          ? !code?.languages.some((l) => l === run.code?.language)
          : !allowCommands;
        if (unrunnable) {
          const note = run.code
            ? i18n.t("terminal.code.noRuntime", { language: run.code.language })
            : i18n.t("terminal.code.noCommandsHere");
          set(run, { state: "failed", output: note, lines: 1, durationMs: 0 });
          continue;
        }
        if (run.state === "queued") set(run, { state: "pending" });
        onNeedsYou?.("approval", batch.length - i);
        const decision = await waitForDecision(run.id, conversationId, signal);
        if (!decision.run) {
          set(run, { state: "rejected", ...(decision.answer && { answer: decision.answer }) });
          break;
        }
        if (run.code) {
          set(run, { code: { ...run.code, source: decision.command }, ...(decision.edited && { edited: true }) });
          if (!(await prepareProgram(run))) continue;
        } else {
          set(run, { command: decision.command, ...(decision.edited && { edited: true }) });
        }
        // Stopped while the program was being saved: it never starts
        if (signal.aborted) break;
        // With every background place taken, it runs like any other and the reply waits for it
        if (run.background && runningInBackground() < MAX_IN_BACKGROUND) {
          inBackground.set(run.n, execute(run));
          continue;
        }
        if (run.background) set(run, { background: false });
        await execute(run);
        if (run.state === "stopped") break;
      }
      // The ones after a rejected or stopped command stay unrun
      for (const run of batch) if (run.state === "pending") set(run, { state: "rejected" });
      // A background one that already ended goes with the rest; the model gets each result once
      batch.filter((run) => inBackground.has(run.n) && !isRunning(run)).forEach((run) => delivered.add(run.n));
      return {
        role: "user",
        content:
          `<command-results>\n${batch.map((r) => resultFor(r, code?.dir)).join("\n")}\n</command-results>` +
          answerNote(batch.find((r) => r.answer)?.answer),
      };
    },

    // The results of background commands that ended since the model last heard, or null
    takeFinished(): Message | null {
      const ended = finishedInBackground();
      return ended.length > 0 ? resultsOf(ended) : null;
    },

    // <nyra-wait>N</nyra-wait>: until that background command ends; with others that ended meanwhile
    async wait(value: string): Promise<Message> {
      const n = Number(value.trim().replace(/^#/, ""));
      const ending = inBackground.get(n);
      if (!ending) {
        return {
          role: "user",
          content: `<command-wait value="${asAttribute(value)}">There is no background command ${asAttribute(value)} in this reply. Write the number from its result, like ${tagged("wait", "2")}.</command-wait>`,
        };
      }
      await ending;
      return resultsOf(finishedInBackground());
    },

    // When the reply ends however it ends. A background program still running goes on by itself (a server never
    // ends): its card keeps up in its message, and its result reaches the model with the next message. The rest stops.
    close() {
      for (const run of runs) {
        if (!isRunning(run)) continue;
        if (inBackground.has(run.n) && !signal.aborted) {
          set(run, { detached: true });
          keepRunning(conversationId, run.id);
        } else {
          void stopCommand(run.id).catch(() => {});
        }
      }
      closed = true;
    },

    read(kind: "output" | "outputSearch", value: string): Message {
      reads++;
      return { role: "user", content: kind === "output" ? readRange(value) : search(value) };
    },
  };
}

// What the user wrote instead of approving a command, for the model to answer in the same reply
function answerNote(answer: string | undefined) {
  if (!answer) return "";
  return (
    `\n<user-message>\n${neutralizeAppTags(answer)}\n</user-message>\n<app-instructions>Instead of running it, the ` +
    "user wrote you this. Answer it now. Don't ask to run that command again in this reply unless they ask for it; " +
    "if they would rather do it themselves, explain how.</app-instructions>"
  );
}

// A command still waiting or running when its reply ends: the reply stopped, so it won't run or was ended. Also one
// stored as running by a Nyra that quit while it ran.
export function settledRun(run: CommandRun): CommandRun {
  if (run.state === "pending" || run.state === "queued") return { ...run, state: "rejected" };
  if (run.state === "running" || run.state === "asking") return { ...run, state: "stopped", hiddenInput: false };
  return run;
}

// Lines of a program left running after its reply that the next messages carry: the model never saw its result
const LATE_RESULT_LINES = 20;

function noteFor(run: CommandRun) {
  const ending =
    run.state === "running" || run.state === "asking"
      ? "still running in the background, left running after that reply; its result comes when it ends"
      : run.state === "rejected" && run.answer
        ? `not run; the user wrote instead: "${asAttribute(shortened(run.answer, MAX_ANSWER_NOTE))}"`
        : run.state === "rejected" || run.state === "queued"
          ? "not run, the user chose not to"
          : run.state === "stopped"
            ? "stopped by the user"
            : run.exitCode === undefined
              ? "couldn't run"
              : `exit code ${run.exitCode}, ${run.lines ?? 0} lines of output`;
  const what = run.code ? `a ${run.code.language} program` : asAttribute(run.command);
  const files = run.files?.length ? `; it created ${run.files.map((f) => asAttribute(f.path)).join(", ")}` : "";
  // Ended after its reply: its last lines, which no reply got
  const late =
    run.detached && !isRunning(run) && run.output?.trim()
      ? `\n  Its last lines, from after that reply:\n${neutralizeAppTags(
          outputTail(withSecretsHidden(run.output).text, LATE_RESULT_LINES).text,
        )}`
      : "";
  return `- ${what}: ${ending}${files}${late}`;
}

// Earlier replies keep a line per command they ran, so the model knows what already happened in the folder
export function withCommandNotes(messages: Message[]): Message[] {
  return messages.map((m) =>
    m.role === "assistant" && m.commands?.length
      ? { ...m, content: `${m.content}\n\n<commands-run>\n${m.commands.map(noteFor).join("\n")}\n</commands-run>` }
      : m,
  );
}
