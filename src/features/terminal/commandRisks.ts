import { i18n } from "@/shared/i18n/i18n";

// Commands that deserve a second look before running, told by their syntax (the shell's words, not the user's
// language). It is a warning, never a block: the user decides.

type CommandRiskKind =
  | "delete"
  | "downloadAndRun"
  | "admin"
  | "gitHistory"
  | "outside"
  | "codeDelete"
  | "codeRuns"
  | "codeNetwork";

type CommandRisk = {
  kind: CommandRiskKind;
  // The part of the command that raised it, underlined in the card
  mark: string;
};

const PATTERNS: { kind: CommandRiskKind; pattern: RegExp }[] = [
  { kind: "downloadAndRun", pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|python3?)\b/ },
  { kind: "downloadAndRun", pattern: /\b(irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^|;]*\|\s*(iex|Invoke-Expression)\b/i },
  { kind: "admin", pattern: /(^|[;&|(]\s*)(sudo|doas)\b/ },
  { kind: "admin", pattern: /\brunas\b|-Verb\s+RunAs\b/i },
  // Any of its options, not only the first: "rm -f -r" deletes as much as "rm -rf"
  { kind: "delete", pattern: /\brm(\s+-[\w-]*)*?\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/ },
  { kind: "delete", pattern: /\bRemove-Item\b[^;|&]*-Recurse\b/i },
  { kind: "delete", pattern: /\b(del|erase|rd|rmdir)\s+\/[sq]\b/i },
  { kind: "delete", pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/ },
  { kind: "gitHistory", pattern: /\bgit\s+push\b[^;|&]*(--force\b|--force-with-lease\b|\s-f\b)/ },
  { kind: "gitHistory", pattern: /\bgit\s+reset\s+--hard\b/ },
  // A path that leaves the folder: going up, the home folder, or an absolute path (also C:\ on Windows)
  { kind: "outside", pattern: /(^|\s)["']?(\.\.([/\\]|\s|$)|~([/\\]|\s|$)|\/(?!dev\/null\b)[\w.-]+\/|[A-Za-z]:[/\\])/ },
];

// A path that goes up past where it starts somewhere in the middle ("src/../../x"); "src/../lib" stays inside
function climbingPath(command: string) {
  return command
    .split(/\s+/)
    .map((word) => word.replace(/^["']|["']$/g, ""))
    .find((word) => {
      let depth = 0;
      for (const part of word.split(/[/\\]/)) {
        if (part === "..") depth--;
        else if (part && part !== ".") depth++;
        if (depth < 0) return true;
      }
      return false;
    });
}

// The first risk found, most serious first. forPaths is the command as checked for paths that leave the folder,
// with the folders Nyra itself uses (a skill's) made relative.
export function commandRisk(command: string, forPaths = command): CommandRisk | null {
  for (const { kind, pattern } of PATTERNS) {
    const match = (kind === "outside" ? forPaths : command).match(pattern);
    if (!match) continue;
    const mark = match[0].trim().replace(/^["']/, "");
    return { kind, mark: command.includes(mark) ? mark : "" };
  }
  const climbing = climbingPath(forPaths);
  if (climbing) return { kind: "outside", mark: command.includes(climbing) ? climbing : "" };
  return null;
}

// The same for a program, by the calls of Python and Node that delete, start other programs or go online
const CODE_PATTERNS: { kind: CommandRiskKind; pattern: RegExp }[] = [
  { kind: "codeDelete", pattern: /\b(os\.(remove|unlink|rmdir|removedirs)|shutil\.rmtree)\s*\(|\.(unlink|rmdir)\s*\(/ },
  { kind: "codeDelete", pattern: /\b(rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(/ },
  { kind: "codeRuns", pattern: /\b(subprocess|os\.(system|popen|exec\w*|spawn\w*)|child_process|execSync|execFileSync|spawnSync)\b/ },
  { kind: "codeNetwork", pattern: /\b(urllib\.request|urlopen|requests\.\w+|httpx|http\.client|socket\.socket|fetch\s*\(|https?\.(get|request)\s*\()/ },
  { kind: "codeNetwork", pattern: /\brequire\(\s*["'](node:)?(https?|net)["']\s*\)|from\s+["'](node:)?(https?|net)["']/ },
];

export function codeRisk(source: string): CommandRisk | null {
  for (const { kind, pattern } of CODE_PATTERNS) {
    const match = source.match(pattern);
    if (match) return { kind, mark: match[0] };
  }
  return null;
}

// What the card says about each risk, in one sentence and a detail
export function riskText(risk: CommandRisk, folder: string): { title: string; detail: string } {
  return {
    title: i18n.t(`terminal.risks.${risk.kind}.title`, { folder }),
    detail: i18n.t(`terminal.risks.${risk.kind}.detail`),
  };
}
