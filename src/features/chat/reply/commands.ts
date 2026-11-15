import type { ParseKeys } from "i18next";
import { i18n } from "@/shared/i18n/i18n";
import { foldForSearch } from "@/shared/lib/search";

// Actions of the app typed with "/" in the composer, listed above the skills. Their names stay in English whatever
// the interface language, so they are the same for everyone.
type CommandName = "compact" | "fork" | "new" | "init" | "model";

export type Command = {
  name: CommandName;
  // One line, for the "/" list; the texts are catalog keys, read in the interface's language when shown
  description: ParseKeys;
  // For Settings → Comandos y atajos: what it does in full, how to type it and when it can't run
  details: ParseKeys;
  // A command as typed ("/compact") stays as it is; an example with words of a language is a key
  examples: (`/${string}` | ParseKeys)[];
  // Follows "No disponible"
  unavailableWhen?: ParseKeys;
  // Picking it writes "/name " in the box and waits for what comes after, instead of running at once
  takesArgument?: boolean;
};

export const COMMANDS: Command[] = [
  {
    name: "compact",
    description: "commands.compact.description",
    details: "commands.compact.details",
    examples: ["/compact"],
    unavailableWhen: "commands.compact.unavailableWhen",
  },
  {
    name: "fork",
    description: "commands.fork.description",
    details: "commands.fork.details",
    examples: ["/fork"],
    unavailableWhen: "commands.fork.unavailableWhen",
  },
  {
    name: "new",
    description: "commands.new.description",
    details: "commands.new.details",
    examples: ["/new", "commands.new.example"],
  },
  {
    name: "init",
    description: "commands.init.description",
    details: "commands.init.details",
    examples: ["/init", "commands.init.example"],
    unavailableWhen: "commands.init.unavailableWhen",
  },
  {
    name: "model",
    description: "commands.model.description",
    details: "commands.model.details",
    examples: ["/model", "/model gemini flash"],
    unavailableWhen: "commands.model.unavailableWhen",
    takesArgument: true,
  },
];

// A command the composer can offer now; unavailable says why it can't run, and it shows disabled. One that takes an
// argument has no run: the box waits for it.
export type ComposerCommand = { name: CommandName; run?: () => void; unavailable?: string };

export function matchCommands(commands: ComposerCommand[], query: string) {
  const q = foldForSearch(query.trim());
  return commands.filter((c) => c.name.includes(q));
}

// "/new explícame qué es una API": the message to send in a new conversation, "" for /new alone, null for
// anything else. The list closes at the first space, so this is read when the message is sent.
export function messageForNew(text: string) {
  const match = text.match(/^\/new(?:\s+([\s\S]*))?$/);
  return match ? (match[1] ?? "").trim() : null;
}

// "/init céntrate en los tests": what the user adds to the request for the project's NYRA.md, "" for /init alone, null
// for anything else
export function initRequestOf(text: string) {
  const match = text.match(/^\/init(?:\s+([\s\S]*))?$/);
  return match ? (match[1] ?? "").trim() : null;
}

// "/model gemini flash": what to look for among the models; null when the text isn't /model with a space
export function modelQueryOf(text: string) {
  return text.match(/^\/model\s+([\s\S]*)$/)?.[1] ?? null;
}

export const takesArgument = (name: CommandName) => !!COMMANDS.find((c) => c.name === name)?.takesArgument;

export function describeCommand(name: CommandName) {
  const command = COMMANDS.find((c) => c.name === name);
  return command ? i18n.t(command.description) : "";
}

const isTyped = (example: Command["examples"][number]): example is `/${string}` => example.startsWith("/");

export const exampleText = (example: Command["examples"][number]) => (isTyped(example) ? example : i18n.t(example));
