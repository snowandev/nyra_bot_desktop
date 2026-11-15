import type { Platform } from "@/shared/lib/platform";
import { tagged } from "@/features/chat/reply/replyTags";
import { type CodeOptions, MAX_IN_BACKGROUND } from "./commandTools";
import { MAX_READ_LINES } from "./outputText";
import { LANGUAGE_NAMES, LISTED_FILES } from "./programs";

// What the model is told about running commands and programs; the tags themselves are read in replyTags

const SHELL: Record<Platform, string> = { mac: "zsh on macOS", windows: "PowerShell on Windows", linux: "bash on Linux" };

// What the model is told about running commands, next to the folder tags
export function commandsPrompt(platform: Platform) {
  return [
    `You can also run commands in the folder, in its terminal (${SHELL[platform]}), each one only after the user ` +
      "approves it:",
    `- ${tagged("run", "command")} asks to run one command, with the folder as its working directory. Several in a ` +
      "row run in that order, each after the one before. Then stop and wait for the results.",
    `- ${tagged("runBackground", "command")} runs a long command in the background: once the user approves it you go ` +
      "on at once, and its result comes to you in a later turn when it ends. Use it only for a long command (a full " +
      "build, the whole test suite, installing dependencies) whose result you don't need for your next steps; if what " +
      `you do next depends on it, use ${tagged("run", "command")}. Up to ${MAX_IN_BACKGROUND} at a time. Never run in ` +
      "the background two commands that write the same files, and don't change files a background command is using.",
    `- ${tagged("wait", "N")} waits until background command N ends and gives you its result. Use it when everything ` +
      "left to do needs that result. Commands still running when you finish your answer aren't waited for: they keep " +
      "running after it, with their card, and their results come to you with the user's next message. A command that " +
      "doesn't end on its own (a development server, a watcher) goes in the background: say in your answer that it " +
      "keeps running and that the user can stop it from its card.",
    "- Right before the tag, say in one short sentence what the command is for.",
    ...(platform === "windows" ? ["- Write PowerShell commands (Get-ChildItem, not ls -la; $env:VAR, not $VAR)."] : []),
    "- Prefer commands that end on their own and ask nothing (--yes, --no-input, CI=1). If one asks something anyway, " +
      "the user can answer it in its card.",
    "- Run commands when they help with what the user asked: tests, builds, git status or log, a linter, installing a " +
      "dependency they want. To read files, use the folder tags, not cat or type.",
    "- Never delete, overwrite, use sudo or touch anything outside the folder unless the user asked for exactly that.",
    `- A result brings the last lines of the output, numbered. To see more of a long one, ${tagged("output", "N 120-300")} ` +
      `reads lines 120 to 300 (up to ${MAX_READ_LINES} at once) and ${tagged("outputSearch", "N text")} finds the lines ` +
      "with that text, where N is the command's number in its result.",
    "- An exit code other than 0 doesn't always mean the command broke: test runners, linters and scanners use it to " +
      "say they found something, and grep when it finds nothing. Read the output before saying it failed.",
    "- If the user rejects or stops a command, don't ask for it again in this reply: go on without it.",
  ].join("\n");
}

// What the model is told about writing and running programs, with the languages this computer can run. With
// commands too, reading long outputs is already explained.
export function codePrompt(
  { languages, packages, missingPackages, dir, files }: Omit<CodeOptions, "conversationId" | "label" | "inputs">,
  inFolder: boolean,
  withCommands: boolean,
) {
  const example = tagged("code", "\n```python\nprint(sum([1200, 850, 430]))\n```\n");
  return [
    "You can also write a short program and run it, each one only after the user approves it, when it helps with " +
      "what they asked: exact calculations, analyzing or converting their files and data, checking an idea. Don't " +
      "write one for what you can answer directly.",
    `- ${example} runs a program: complete, in a fenced block that names its language. Available on this computer: ` +
      `${languages.map((l) => `${l} (${LANGUAGE_NAMES[l]})`).join(", ")}. Several in a row run in that order. Then stop ` +
      "and wait for the results.",
    `- ${tagged("codeBackground", "…")} runs a long program in the background: once the user approves it you go on at ` +
      "once, and its result comes to you in a later turn when it ends. Use it only for a long program (processing many " +
      "files, a heavy analysis) whose result you don't need for your next steps; if what you do next or your answer " +
      `depends on it, which is almost always, use ${tagged("code", "…")}. Never run in the background two programs that ` +
      "write the same files.",
    ...(withCommands
      ? []
      : [
          `- ${tagged("wait", "N")} waits until background program N ends and gives you its result. Use it when ` +
            "everything left to do needs that result. Programs still running when you finish your answer aren't waited " +
            "for: they keep running after it, with their card, and their results come to you with the user's next " +
            "message. A program that doesn't end on its own (a local server) goes in the background: say in your " +
            "answer that it keeps running and that the user can stop it from its card.",
        ]),
    "- Right before the tag, say in one short sentence what the program does.",
    inFolder
      ? "- It runs in the connected folder, so it reads the project's files by their paths. Never change, delete or " +
        "overwrite them unless the user asked for exactly that."
      : "- Its working directory is a folder of this conversation.",
    files.length > 0
      ? `- The files attached to this conversation are in "${dir}": ${files.slice(0, LISTED_FILES).join(", ")}` +
        `${files.length > LISTED_FILES ? ` and ${files.length - LISTED_FILES} more` : ""}. Open them by these exact ` +
        "names, and leave them as they are."
      : "",
    `- Save the files you create (a chart as PNG, a table as CSV or XLSX, a converted file) in "${dir}", with new ` +
      "names, and say their names: the user sees and saves them from the program's card.",
    languages.includes("python") && packagesLine(packages, missingPackages),
    "- Print what you need to know: you get its output. If an import fails, tell the user what to install instead " +
      "of retrying the same.",
    "- To show a chart in your answer a chart block is enough; use a program to compute its data or to make an image file.",
    ...(withCommands
      ? []
      : [
          `- A result brings the last lines of the output. To see more of a long one, ${tagged("output", "N 120-300")} ` +
            `reads those lines and ${tagged("outputSearch", "N text")} finds lines, where N is the program's number in ` +
            "its result.",
        ]),
    "- If the user rejects or stops a program, don't ask for it again in this reply: go on without it.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Which Python packages exist, said both ways: told only what is installed, models still reach for the usual ones
function packagesLine(installed: string[], missing: string[]) {
  if (installed.length === 0 && missing.length === 0) return "";
  const has = installed.length > 0 ? `installed: ${installed.join(", ")}` : "none installed besides the standard library";
  const lacks = missing.length > 0 ? `; NOT installed, importing them fails: ${missing.join(", ")}` : "";
  const drawing = !installed.includes("matplotlib") && installed.includes("PIL") ? " (a chart image can be drawn with PIL)" : "";
  return `- Python packages ${has}${lacks}. Write the program with what is installed${drawing}.`;
}
