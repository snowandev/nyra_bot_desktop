import { useRef, useState } from "react";
import { fitToContext, tooLargeMessage } from "./contextFit";
import { hasReplyCards } from "./replyCards";
import { errorMessage, isOutOfMemory, outOfMemoryMessage } from "@/shared/lib/errors";
import { CHANGES_PROMPT, takeChanges } from "@/features/workspace/fileChanges";
import { memoriesPrompt, withoutMemoryTags } from "@/features/memory/memories";
import { configForModel, deliverByFrame, frameBuffer, messagesForModel } from "./modelRequest";
import { activeSkillsOf, systemPrompt, withRequestNotes } from "./replyRequest";
import { withoutRequestTags } from "./replyTags";
import { withoutEmptyVersion } from "./replyVersions";
import { applyReplyOutcome, type MemoryAccess } from "./replyOutcome";
import { replyWithSearch } from "./replyWithSearch";
import { prepareReplyTools } from "./replyTools";
import { throwIfStopped, untilStopped } from "./stopped";
import { type Skill, skillLoadedMessage } from "@/features/skills/skills";
import { estimateTextTokens, estimateTokens, historyForModel } from "./summary";
import type { UserRules } from "./userRules";
import { explicitSearchQuery, type SearchStepProgress } from "@/features/web/webSearchAgent";
import {
  changedSinceRead,
  earlierReadsPrompt,
  indexBudget,
  indexText,
  learnedLimit,
  readBudget,
  withFolderNote,
  workspaceContext,
  workspacePrompt,
} from "@/features/workspace/workspace";
import { type WorkspaceStep, workspaceTools } from "@/features/workspace/workspaceTools";
import { mentionedFilesNote, mentionedPaths } from "@/features/workspace/mentions";
import { COMMIT_PROMPT, takeCommit } from "@/features/projects/commits";
import { appendToLastUserMessage } from "./messageNotes";
import { readGuideFile, readWorkspaceText } from "@/features/workspace/workspaceFiles";
import {
  type GuideFile,
  guideNames,
  guidesIn,
  projectGuidesPrompt,
  WRITE_GUIDE_PROMPT,
} from "@/features/workspace/projectGuides";
import { type CommandNeed, commandTools, settledRun, withCommandNotes } from "@/features/terminal/commandTools";
import { codePrompt, commandsPrompt } from "@/features/terminal/commandPrompts";
import { openPageNote } from "@/features/browser/browserTools";
import { transcriptionTools } from "@/features/transcription/transcriptionTools";
import { platformName } from "@/shared/lib/platform";
import { type MeaningMatch, meaningSearch, outlineWorkspace, searchWorkspace } from "@/features/workspace/workspaceStorage";
import { getProvider } from "@/providers";
import { ollama } from "@/providers/ollama";
import { embed, embeddingQuery, loadedContextWindow } from "@/providers/ollamaModels";
import {
  loadLearnedContexts,
  loadLoadedContexts,
  loadPreferences,
  saveLearnedContext,
  saveLoadedContext,
} from "@/shared/storage/settings";
import type {
  ConversationSummary,
  Message,
  Model,
  ProviderConfig,
  WebSearchRecord,
  WorkspaceFolder,
} from "@/shared/types";
import type { WorkspaceSnapshot } from "@/features/workspace/useWorkspaces";

// Fragments one search by meaning returns: enough to find where something is handled, few enough to read them all
const FIND_LIMIT = 6;

type SearchProgress = { conversationId: string; steps: SearchStepProgress[] };
type SkillProgress = { conversationId: string; names: string[] };
type WorkspaceProgress = { conversationId: string; steps: WorkspaceStep[] };

// What a reply depends on besides its history
type ReplyContext = {
  skillNames?: string[];
  // A private conversation neither uses the memories nor adds to them, like a browser's private window
  isPrivate?: boolean;
  // Only the model and the files: none of the user's rules, no skills, search, folder, commands, browser nor MCP
  isIsolated?: boolean;
  workspace?: WorkspaceFolder;
  // «Automático»: the main model may hand the task over; then nothing is kept and this is called instead
  onEscalate?: () => void;
};

type Update<T> = (conversationId: string, update: (value: T) => T) => void;

type Options = {
  configFor: (providerId: string) => ProviderConfig;
  skills: Skill[];
  userRules: UserRules | null;
  // The same without the user's name and occupation, for a private conversation
  privateUserRules: UserRules | null;
  webSearch: boolean;
  runCommands: boolean;
  // Programs the model writes and runs, with or without a folder
  runCode: boolean;
  // The model may use the browser installed on this computer
  browser: boolean;
  // null while memory is off
  memory: MemoryAccess | null;
  // Reads the connected folder again right before the reply
  prepareWorkspace: (conversationId: string, folder: WorkspaceFolder) => Promise<WorkspaceSnapshot | null>;
  // Holds the folders' vectors back while a local model writes; returns how to let them go on
  pauseMeaning?: () => () => void;
  // What every request of a conversation carries besides its history, with the model that answers it
  reservedTokensOf: (
    conversation: { isPrivate?: boolean; isIsolated?: boolean; skills?: string[]; workspace?: WorkspaceFolder },
    replyModel: Model,
  ) => number;
  updateMessages: Update<Message[]>;
  updateReply: Update<Message>;
  onReplyCompleted?: () => void;
  // A command waits for the user to approve it or answer it
  onCommandNeedsYou?: (need: CommandNeed, count: number) => void;
};

// The reasoning of a model that thinks, painted once per frame like the reply. Only the time spent thinking
// counts, not the searches in between, which have their own card.
function reasoningReceiver(conversationId: string, updateReply: Update<Message>) {
  const buffer = frameBuffer((text) =>
    updateReply(conversationId, (reply) => ({
      ...reply,
      reasoning: { ...reply.reasoning, text: (reply.reasoning?.text ?? "") + text },
    })),
  );
  let thinkingSince: number | null = null;
  let thoughtMs = 0;
  return {
    onThinking(text: string) {
      // Each stretch of thinking, also after a command: the reply's line counts again until it stops
      if (thinkingSince === null) {
        const since = Date.now();
        thinkingSince = since;
        updateReply(conversationId, (reply) => ({
          ...reply,
          reasoning: { text: reply.reasoning?.text ?? "", ...reply.reasoning, thinkingSince: since },
        }));
      }
      buffer.push(text);
    },
    // The model started answering or searching
    stop() {
      buffer.end();
      if (thinkingSince === null) return;
      // By the clock, like the line that counts while it thinks: the WebView's own timer stops while macOS puts a
      // hidden Nyra to sleep, and the total came out shorter than what the line had shown
      thoughtMs += Date.now() - thinkingSince;
      thinkingSince = null;
      const durationMs = thoughtMs;
      updateReply(conversationId, (reply) => ({
        ...reply,
        reasoning: { text: reply.reasoning?.text ?? "", durationMs },
      }));
    },
  };
}

// The index the model gets and the tools it uses on the folder; null when not even the collapsed index fits
type WorkspaceSetup = {
  snapshot: WorkspaceSnapshot;
  // The project's instructions at the top of the folder, and which files count as instructions
  guides: GuideFile[];
  guideNames: string[];
  history: Message[];
  contextWindow: number | undefined;
  usedTokens: number;
  onSteps: (steps: WorkspaceStep[]) => void;
  // Vision models also get the pictures of scanned pages and figures of the PDFs they read
  withVisuals: boolean;
  // Search by meaning, when the folder's vectors are ready
  find?: (query: string) => Promise<MeaningMatch[]>;
  // The model may ask to run commands in the folder
  canRunCommands: boolean;
};

function workspaceSetup(setup: WorkspaceSetup) {
  const { snapshot, guides, history, contextWindow, usedTokens, onSteps, withVisuals, find, canRunCommands } = setup;
  const index = indexText(snapshot.files, indexBudget(contextWindow));
  if (!index) return null;
  const { folder, files, changes } = snapshot;
  const earlierReads = earlierReadsPrompt(history, folder.path);
  const guideText = projectGuidesPrompt(guides);
  const budget = readBudget(
    contextWindow,
    usedTokens + index.tokens + estimateTextTokens(guideText) + estimateTextTokens(earlierReads ?? ""),
  );
  const changed = changedSinceRead(history, files);
  const tools = workspaceTools({
    name: folder.name,
    root: folder.path,
    files,
    budget,
    read: (path, from, to) => readWorkspaceText(folder.path, path, from, to, withVisuals),
    search: (query) => searchWorkspace(folder.path, query),
    outline: (path) => outlineWorkspace(folder.path, path),
    find,
    onSteps,
    // A subfolder's own instructions come with the first file read in it
    guides: {
      followed: guides.map((g) => g.path),
      inFolder: (directory) => guidesIn(directory, setup.guideNames, (path) => readGuideFile(folder.path, path)),
    },
    firstSteps: [
      { kind: "changes", changes, done: true },
      ...changed.map((path) => ({ kind: "changedSinceRead" as const, path, done: true })),
    ],
  });
  // Only what stays the same between messages; earlierReads changes after each reply and goes in withFolderNote
  const prompt = [
    workspacePrompt(folder.name, index, snapshot.truncated, !!find),
    guideText,
    CHANGES_PROMPT,
    canRunCommands && commandsPrompt(platformName),
  ]
    .filter(Boolean)
    .join("\n");
  const modifiedOf = new Map(files.map((f) => [f.path, f.modified]));
  // What every request of the reply carries before reading anything
  const baseTokens = usedTokens + estimateTextTokens(prompt) + estimateTextTokens(earlierReads ?? "");
  return { prompt, tools, changed, earlierReads, root: folder.path, name: folder.name, modifiedOf, baseTokens };
}

// Without a folder there is no list of steps: the programs' cards say what they do
const NO_STEPS = { begin: () => -1, finish: () => undefined };

const cleanText = (text: string) => takeCommit(takeChanges(withoutMemoryTags(withoutRequestTags(text))).text).text;

// What the user reads once the reply ends or stops: no request or memory tags, even half written. The commands'
// cards keep their place in the text that is left.
function withoutAppTags(reply: Message): Message {
  if (reply.role !== "assistant") return reply;
  // A program left running after the reply goes on; the rest that waited or ran was stopped with it
  const commands = reply.commands?.map((run) => (run.detached ? run : settledRun(run)));
  if (!reply.content.includes("<")) return commands ? { ...reply, commands } : reply;
  const content = cleanText(reply.content);
  const placed = commands?.map((run) => ({ ...run, at: cleanText(reply.content.slice(0, run.at)).length }));
  return { ...reply, content, ...(placed && { commands: placed }) };
}

// Writes a reply into its conversation as it arrives: searching, loading skills, the reasoning, and what is left once
// it ends or fails. One reply at a time.
export function useReplyStream(options: Options) {
  // webSearch, runCode and browser are read per reply: an isolated conversation turns them off
  const { configFor, skills, runCommands, memory, updateMessages, updateReply } = options;
  const { onReplyCompleted, onCommandNeedsYou, prepareWorkspace, pauseMeaning } = options;
  // The conversation receiving a reply; state rather than read from the ref, so saving reacts when it ends
  const [streamingId, setStreamingId] = useState<string | null>(null);
  // Kept with the conversation it belongs to, so it shows only there
  const [error, setError] = useState<{ conversationId: string; message: string } | null>(null);
  const failIn = (conversationId: string) => (message: string) => setError({ conversationId, message });
  const clearErrorOf = (conversationId: string) =>
    setError((current) => (current?.conversationId === conversationId ? null : current));
  const streamRef = useRef<{ conversationId: string; controller: AbortController } | null>(null);
  // The searches of the reply being written, for the progress card; empty once it starts answering
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  // The skills being loaded for the reply being written, for the "Escribiendo…" card; cleared once it answers
  const [skillProgress, setSkillProgress] = useState<SkillProgress | null>(null);
  // What the reply being written looks at in the folder; cleared once it answers
  const [workspaceProgress, setWorkspaceProgress] = useState<WorkspaceProgress | null>(null);

  // Resolves with the answer as written (for naming a new conversation), or null if nothing arrived
  async function streamReply(
    conversationId: string,
    history: Message[],
    replyModel: Model,
    summary: ConversationSummary | undefined,
    context: ReplyContext = {},
  ): Promise<string | null> {
    const { isPrivate = false, isIsolated = false } = context;
    // Isolated, each of these is off whatever Settings say
    const skillNames = isIsolated ? [] : (context.skillNames ?? []);
    const workspace = isIsolated ? undefined : context.workspace;
    const onEscalate = isIsolated ? undefined : context.onEscalate;
    const webSearch = !isIsolated && options.webSearch;
    const runCode = !isIsolated && options.runCode;
    const browser = !isIsolated && options.browser;
    const provider = getProvider(replyModel.providerId);
    if (!provider) return null;
    let answer = "";
    // Text shown before the reply's latest commands: their cards sit after it, so it is never cleared
    let kept = 0;

    const controller = new AbortController();
    streamRef.current = { conversationId, controller };
    setStreamingId(conversationId);
    clearErrorOf(conversationId);
    // By the clock: the WebView's own timer stops while macOS puts a hidden Nyra to sleep
    const startedAt = Date.now();
    const reasoning = reasoningReceiver(conversationId, updateReply);
    const marked = activeSkillsOf(skills, skillNames);
    const memories = memory && !isPrivate ? memoriesPrompt(memory.texts, true) : null;
    const userRules = isIsolated ? null : isPrivate ? options.privateUserRules : options.userRules;
    const isLocal = !provider.requiresApiKey;
    let folder: ReturnType<typeof workspaceSetup> = null;
    // The size of the last request, to learn what fits in memory if this computer runs out of it
    let requestTokens = 0;
    let resumeMeaning: (() => void) | undefined;
    let closeCommands: (() => void) | undefined;
    let closeBrowsing: (() => void) | undefined;
    let closeScreen: (() => void) | undefined;
    let hideSecrets: ((text: string) => string) | undefined;

    try {
      const config = configFor(provider.id);
      const full = messagesForModel(withCommandNotes(historyForModel(history, summary)), replyModel);
      const reserved = options.reservedTokensOf({ isPrivate, isIsolated, skills: skillNames, workspace }, replyModel);
      const showSteps = (steps: WorkspaceStep[]) => setWorkspaceProgress({ conversationId, steps });
      if (workspace) showSteps([{ kind: "changes", changes: null, done: false }]);
      const tools = await prepareReplyTools({
        conversationId,
        history,
        replyModel,
        provider,
        config,
        signal: controller.signal,
        isIsolated,
        runCode,
        browser,
        canEscalate: !!onEscalate,
        workspace,
        prepareWorkspace,
        offset: () => answer.length,
        updateReply,
        onCommandNeedsYou,
      });
      const { code, openPage, browsing, looking, connected, snapshot, prompts: otherTools } = tools;
      closeBrowsing = browsing?.close;
      closeScreen = looking?.close;
      hideSecrets = browsing?.hideSecrets;
      // They and the open page go with every request, so the history leaves room for them
      const toolsTokens = estimateTextTokens(
        [code && codePrompt(code, !!workspace, !!workspace && runCommands), ...otherTools, openPage && openPageNote(openPage)]
          .filter(Boolean)
          .join("\n\n"),
      );
      // Against the model's maximum, not the context loaded or set in Settings: Ollama reads past those (tested
      // with 0.40), but a model can't use text beyond the context it was built for, and cloud APIs reject it
      const fit = fitToContext(full, replyModel.contextWindow, reserved + toolsTokens, !!summary);
      if (fit.kind === "too-large") throw new Error(tooLargeMessage(fit, replyModel.name));
      const sent = fit.kind === "trimmed" ? fit.messages : full;
      requestTokens = estimateTokens(sent) + reserved + toolsTokens;
      if (workspace) {
        // NYRA.md always; other assistants' instructions (AGENTS.md, CLAUDE.md) only with their compatibility on
        const names = guideNames(loadPreferences().compatibleGuides);
        const guides = snapshot
          ? await untilStopped(guidesIn("", names, (path) => readGuideFile(workspace.path, path)), controller.signal)
          : [];
        // Ollama sizes the context it loads to this computer; known once the model is loaded
        const loaded =
          provider.id === ollama.id ? await loadedContextWindow(config, replyModel.id, controller.signal) : undefined;
        throwIfStopped(controller.signal);
        if (loaded && !config.contextLength) saveLoadedContext(replyModel.id, loaded);
        const context = workspaceContext(replyModel.contextWindow, {
          isLocal,
          configured: config.contextLength,
          loaded: loaded ?? loadLoadedContexts()[replyModel.id],
          learned: loadLearnedContexts()[replyModel.id],
        });
        const withVisuals = replyModel.supportsImages !== false;
        const meaningModel = snapshot?.meaningModel;
        // The question goes through the same embedding model as the folder's fragments, in Ollama
        const find =
          meaningModel && workspace
            ? async (query: string) => {
                const [vector] = await embed(configFor(ollama.id), meaningModel, [embeddingQuery(meaningModel, query)]);
                return meaningSearch(workspace.path, meaningModel, vector, FIND_LIMIT);
              }
            : undefined;
        folder =
          snapshot &&
          workspaceSetup({
            snapshot,
            guides,
            guideNames: names,
            history,
            contextWindow: context,
            usedTokens: requestTokens,
            onSteps: showSteps,
            withVisuals,
            find,
            canRunCommands: runCommands,
          });
        if (!folder) setWorkspaceProgress(null);
      }
      // After the folder is ready, which may have waited for a few changed files to get their vectors
      if (provider.id === ollama.id) resumeMeaning = pauseMeaning?.();
      // With a folder the model may also run commands in it, and with or without one write programs; each runs once the
      // user approves it
      const allowCommands = !!folder && runCommands;
      const commands =
        allowCommands || code
          ? commandTools({
              conversationId,
              folder: folder && { root: folder.root, name: folder.name },
              allowCommands,
              code,
              offset: () => answer.length,
              update: (change) =>
                updateReply(conversationId, (reply) => ({ ...reply, commands: change(reply.commands ?? []) })),
              // Its card stays where the reply's cleanup put it in the text
              writeAfter: (run) =>
                updateMessages(conversationId, (messages) =>
                  messages.map((m) =>
                    m.commands?.some((r) => r.id === run.id)
                      ? { ...m, commands: m.commands.map((r) => (r.id === run.id ? { ...run, at: r.at } : r)) }
                      : m,
                  ),
                ),
              steps: folder?.tools ?? NO_STEPS,
              signal: controller.signal,
              onNeedsYou: onCommandNeedsYou,
            })
          : undefined;
      closeCommands = commands?.close;
      // An attached audio is transcribed only when the reply asks for it; its transcript stays with its message
      const transcribing = transcriptionTools({
        conversationId,
        history,
        signal: controller.signal,
        onTranscript: (audioId, transcript) =>
          updateMessages(conversationId, (messages) =>
            messages.map((m) =>
              m.attachments?.some((a) => a.id === audioId)
                ? {
                    ...m,
                    attachments: [
                      ...m.attachments.map((a) => (a.id === audioId ? { ...a, transcript: transcript.id } : a)),
                      transcript,
                    ],
                  }
                : m,
            ),
          ),
        onShow: (id) =>
          updateReply(conversationId, (reply) => ({
            ...reply,
            transcripts: [...(reply.transcripts ?? []).filter((t) => t.id !== id), { at: answer.length, id }],
          })),
      });
      const toolsPrompt =
        [folder?.prompt, folder && COMMIT_PROMPT, code && codePrompt(code, !!folder, allowCommands), ...otherTools]
          .filter(Boolean)
          .join("\n\n") || null;
      // A reply always follows the user's message
      const lastUser = history[history.length - 1];
      // The files the user mentioned with @ go with the message, read before the model starts
      const mentioned =
        folder && lastUser?.role === "user" ? mentionedPaths(lastUser.content, new Set(folder.modifiedOf.keys())) : [];
      const mentionedFiles =
        folder && mentioned.length > 0 ? await untilStopped(folder.tools.preread(mentioned), controller.signal) : null;
      const { result } = await deliverByFrame(
        (onToken, discardPending) =>
          replyWithSearch({
            chat: (messages, onChatToken, signal, quickStep) =>
              provider.chat({ ...configForModel(config, replyModel), ...(quickStep && { reasoning: false }) }, replyModel, {
                messages,
                system: systemPrompt(userRules, marked, memories, toolsPrompt),
                onToken: onChatToken,
                signal,
                onThinking: reasoning.onThinking,
              }),
            history: appendToLastUserMessage(
              withFolderNote(
                // Isolated, not even a skill a message names gets read
                withRequestNotes(sent, isIsolated ? [] : skills, userRules, !!commands),
                folder?.changed ?? [],
                folder?.earlierReads ?? null,
              ),
              [
                mentionedFiles && mentionedFilesNote(mentionedFiles),
                openPage && openPageNote(openPage),
                folder && lastUser?.role === "user" && lastUser.writesGuide && WRITE_GUIDE_PROMPT,
              ]
                .filter(Boolean)
                .join("\n\n"),
            ),
            canSearch: webSearch,
            canEscalate: !!onEscalate,
            skillTurn:
              marked.length > 0
                ? (names, canAskAnother) => {
                    const found = marked.filter((s) => names.includes(s.name));
                    const missing = names.filter((n) => !marked.some((s) => s.name === n));
                    // Kept with the reply, so it shows which skills the model chose on its own
                    if (found.length > 0) {
                      setSkillProgress({ conversationId, names: found.map((s) => s.name) });
                      updateReply(conversationId, (reply) => ({
                        ...reply,
                        skillsUsed: [...new Set([...(reply.skillsUsed ?? []), ...found.map((s) => s.name)])],
                      }));
                    }
                    return skillLoadedMessage(found, missing, canAskAnother, !!commands);
                  }
                : undefined,
            workspace: folder?.tools,
            commands,
            browser: browsing,
            transcription: transcribing.hasAudio ? transcribing : undefined,
            tools: connected,
            screen: looking,
            onKeepText: () => {
              kept = answer.length;
            },
            onWaiting: () => reasoning.stop(),
            forcedQuery: webSearch && lastUser?.role === "user" ? explicitSearchQuery(lastUser.content) : null,
            contextWindow: replyModel.contextWindow,
            signal: controller.signal,
            onText: (text) => {
              reasoning.stop();
              setSkillProgress(null);
              setWorkspaceProgress(null);
              // What follows a command starts a paragraph of its own, below its card
              const next = kept > 0 && answer.length === kept && !/^\s/.test(text) ? `\n\n${text}` : text;
              answer += next;
              onToken(next);
            },
            onClearText: () => {
              answer = answer.slice(0, kept);
              discardPending();
              updateReply(conversationId, (reply) => ({ ...reply, content: answer }));
            },
            onProgress: (steps) => {
              if (steps.length > 0) reasoning.stop();
              setSearchProgress(steps.length > 0 ? { conversationId, steps } : null);
            },
            onRecord: (record: WebSearchRecord) =>
              updateReply(conversationId, (reply) => ({ ...reply, webSearch: record })),
          }),
        (text) => updateReply(conversationId, (reply) => ({ ...reply, content: reply.content + text })),
      );
      if (result.escalated) {
        // Nothing of it stays: the empty reply gives way, and the other model answers the same message
        updateReply(conversationId, (reply) => ({ ...reply, content: "" }));
        onEscalate?.();
        return null;
      }
      const { usage, received } = result;
      if (folder?.tools.hasConsulted()) {
        const consult = folder.tools.consult();
        updateReply(conversationId, (reply) => ({ ...reply, workspaceConsult: consult }));
      }
      if (usage) {
        const contextUsage = { used: usage.inputTokens + usage.outputTokens, limit: usage.contextWindow };
        // With the size left automatic, what Ollama loaded is the context the meter and the summary measure against
        if (provider.id === ollama.id && !config.contextLength && usage.contextWindow) {
          saveLoadedContext(replyModel.id, usage.contextWindow);
        }
        const stats = { outputTokens: usage.outputTokens, durationMs: Date.now() - startedAt };
        updateReply(conversationId, (reply) => ({ ...reply, usage: contextUsage, stats }));
      }
      const text = await applyReplyOutcome({
        answer,
        history,
        folder: folder && { root: folder.root, modifiedOf: folder.modifiedOf },
        memory: memory && !isPrivate ? memory : null,
        conversationId,
        setReply: (change) => updateReply(conversationId, change),
        onError: failIn(conversationId),
      });
      if (received) onReplyCompleted?.();
      // What is handed on (for the title, a summary) without a password the model repeated, as the reply keeps it
      return received ? (hideSecrets?.(text) ?? text) : null;
    } catch (e) {
      if (controller.signal.aborted) return null;
      if (isLocal && isOutOfMemory(errorMessage(e))) {
        // Next time a folder reads less at once with this model, on this computer
        const failed = folder ? folder.baseTokens + folder.tools.consult().tokens : requestTokens;
        const known = loadLearnedContexts()[replyModel.id];
        saveLearnedContext(replyModel.id, Math.min(known ?? Infinity, learnedLimit(failed)));
        failIn(conversationId)(outOfMemoryMessage(replyModel.name, !!folder));
      } else {
        failIn(conversationId)(errorMessage(e));
      }
      return null;
    } finally {
      resumeMeaning?.();
      closeCommands?.();
      closeBrowsing?.();
      closeScreen?.();
      reasoning.stop();
      // Also a model that kept asking after the last allowed request, or a reply stopped halfway through a tag
      updateReply(conversationId, withoutAppTags);
      // The model is told never to repeat a password it typed; if it does, the reply doesn't keep it
      if (hideSecrets) {
        const hide = hideSecrets;
        updateReply(conversationId, (reply) => ({ ...reply, content: hide(reply.content) }));
      }
      // Nothing arrived: a new version gives way to the latest one, a first reply to nothing. One with cards stays, with
      // what it did.
      updateMessages(conversationId, (messages) => {
        const last = messages[messages.length - 1];
        if (last?.role !== "assistant" || last.content || hasReplyCards(last)) return messages;
        const restored = withoutEmptyVersion(last);
        return restored ? [...messages.slice(0, -1), restored] : messages.slice(0, -1);
      });
      setStreamingId(null);
      setSearchProgress(null);
      setSkillProgress(null);
      setWorkspaceProgress(null);
      streamRef.current = null;
    }
  }

  // Stops the reply in progress; with an id, only if it is that conversation's
  function stop(conversationId?: string) {
    if (!conversationId || streamRef.current?.conversationId === conversationId) streamRef.current?.controller.abort();
  }

  return {
    streamReply,
    stop,
    streamingId,
    isStreaming: streamingId !== null,
    errorOf: (conversationId: string | null) => (error?.conversationId === conversationId ? error.message : null),
    clearError: clearErrorOf,
    searchProgress,
    skillProgress,
    workspaceProgress,
  };
}
