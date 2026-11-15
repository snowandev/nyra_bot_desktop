import { markAccent } from "@/shared/lib/theme";
import { loadPreferences } from "@/shared/storage/settings";
import type { Attachment, Message, Model, ProviderConfig, WorkspaceFolder } from "@/shared/types";
import type { Provider } from "@/providers/types";
import { hasAttachedWorkbooks, SHEET_ATTACHMENTS_PROMPT } from "@/features/attachments/sheetVersions";
import { codeSetup } from "@/features/terminal/codeSetup";
import { ESCALATE_PROMPT } from "@/features/models/modelRouting";
import { browserPrompt, browserTools } from "@/features/browser/browserTools";
import { openAddress } from "@/features/browser/browserSession";
import { browserAvailable, browserSnapshot } from "@/features/browser/browserStorage";
import { mcpPrompt, mcpSetup, mcpTools } from "@/features/mcp/mcpTools";
import { screenPrompt, screenTools } from "@/features/screen-look/screenTools";
import { boxFormatFor } from "@/features/screen-look/screenGrounding";
import { screenLookAvailable } from "@/features/screen-look/screenStorage";
import type { CommandNeed } from "@/features/terminal/commandTools";
import type { WorkspaceSnapshot } from "@/features/workspace/useWorkspaces";
import { configForModel } from "./modelRequest";
import { untilStopped } from "./stopped";

type Setup = {
  conversationId: string;
  history: Message[];
  replyModel: Model;
  provider: Provider;
  config: ProviderConfig;
  signal: AbortSignal;
  isIsolated: boolean;
  runCode: boolean;
  browser: boolean;
  canEscalate: boolean;
  workspace?: WorkspaceFolder;
  prepareWorkspace: (conversationId: string, folder: WorkspaceFolder) => Promise<WorkspaceSnapshot | null>;
  // Where the reply's text is now: a tool's card goes there
  offset: () => number;
  updateReply: (conversationId: string, update: (reply: Message) => Message) => void;
  onCommandNeedsYou?: (need: CommandNeed, count: number) => void;
};

// What a reply can use besides answering, other than the folder's own tools: ready before its first word, all at
// once since none needs another, with the folder read again alongside. Without the folder (moved, no access) the
// reply still goes ahead; the composer says what happened. MCP servers not running start.
export async function prepareReplyTools(setup: Setup) {
  const { conversationId, history, replyModel, provider, config, signal, isIsolated, workspace } = setup;
  const { offset, updateReply } = setup;
  const seesImages = replyModel.supportsImages !== false;
  // Only with a browser Nyra can drive installed: the user's Chrome, Edge or another Chromium one. A browser left
  // open: the model gets its page now, so it acts on it without having to look first.
  const browserReady = async () => {
    const canBrowse = setup.browser && !!(await browserAvailable().catch(() => null));
    const page = canBrowse && openAddress(conversationId) ? await browserSnapshot(conversationId).catch(() => null) : null;
    return { canBrowse, openPage: page };
  };
  // The user's screen, for a model that sees images; looking is asked once per conversation
  const screenReady = async () =>
    !isIsolated && loadPreferences().screenLook && seesImages && (await screenLookAvailable().catch(() => false));
  const [code, { canBrowse, openPage }, canLook, catalog, snapshot] = await untilStopped(
    Promise.all([
      setup.runCode ? codeSetup(conversationId, history) : null,
      browserReady(),
      screenReady(),
      isIsolated ? null : mcpSetup(signal),
      workspace ? setup.prepareWorkspace(conversationId, workspace).catch(() => null) : null,
    ]),
    signal,
  );

  const browsing = canBrowse
    ? browserTools({
        conversationId,
        markColor: markAccent(),
        seesImages,
        request: history.at(-1)?.role === "user" ? (history.at(-1)?.content ?? "") : "",
        page: openPage,
        signal,
        onScreenshot: (shot) =>
          updateReply(conversationId, (reply) => ({ ...reply, attachments: [...(reply.attachments ?? []), shot] })),
        offset,
        onRecord: (record) => updateReply(conversationId, (reply) => ({ ...reply, browser: record })),
      })
    : undefined;
  const looking = canLook
    ? screenTools({
        conversationId,
        signal,
        boxFormat: boxFormatFor(replyModel),
        // Where something is, asked to the same model apart from the reply, without reasoning: only a box
        see: async (image, prompt) => {
          let text = "";
          const picture: Attachment = {
            id: crypto.randomUUID(),
            kind: "image",
            name: "screen.jpg",
            mimeType: "image/jpeg",
            data: image,
          };
          await provider.chat({ ...configForModel(config, replyModel), reasoning: false }, replyModel, {
            messages: [{ role: "user", content: prompt, attachments: [picture] }],
            onToken: (token) => {
              text += token;
            },
            signal,
          });
          return text;
        },
        offset,
        onRecord: (record) => updateReply(conversationId, (reply) => ({ ...reply, screen: record })),
      })
    : undefined;
  // Only with a server running there is a tool to use; the prompt still says which ones couldn't start
  const connected =
    catalog && catalog.servers.length > 0
      ? mcpTools(catalog, {
          signal,
          offset,
          update: (change) =>
            updateReply(conversationId, (reply) => ({ ...reply, toolCalls: change(reply.toolCalls ?? []) })),
          onNeedsYou: () => setup.onCommandNeedsYou?.("approval", 1),
        })
      : undefined;
  // Their instructions; the folder's own, and the code's (which depends on the folder), are added by the reply
  const prompts = [
    browsing && browserPrompt(!!openPage, !!looking),
    catalog && catalog.servers.length + catalog.failed.length > 0 && mcpPrompt(catalog),
    looking && screenPrompt(),
    setup.canEscalate && ESCALATE_PROMPT,
    hasAttachedWorkbooks(history) && SHEET_ATTACHMENTS_PROMPT,
  ];
  return { code, openPage, browsing, looking, connected, snapshot, prompts };
}
