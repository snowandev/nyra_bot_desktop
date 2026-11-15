import type { SendOptions } from "@/features/chat/reply/useChat";
import { i18n } from "@/shared/i18n/i18n";
import type { WorkspaceFolder } from "@/shared/types";
import {
  BookOpen,
  Bug,
  FileText,
  FlaskConical,
  GitCommitHorizontal,
  type LucideIcon,
  Package,
  ScanSearch,
  WandSparkles,
} from "lucide-react";

// The skills that come with Nyra for the Código space, as the interface presents them. Their instructions are
// built-in skills like any other (src-tauri/builtin-skills); this only adds what the screens need.
export type CodeSkill = {
  name: string;
  title: string;
  // On a home's task card
  task: string;
  description: string;
  icon: LucideIcon;
  // Sent as it is when the task needs nothing else; otherwise the composer asks for it with the hint
  prompt?: string;
  hint?: string;
  needsGit?: boolean;
};

type TextId =
  | "explainProject"
  | "codeReview"
  | "writeTests"
  | "debug"
  | "refactor"
  | "commitAndPr"
  | "updateDependencies"
  | "documentCode";

// The texts are read from the catalog each time they're shown, so they follow the interface's language. "start" is
// either the message sent as is or the composer's hint, depending on whether the task needs anything else.
function codeSkill(name: string, id: TextId, icon: LucideIcon, start: "prompt" | "hint", needsGit = false): CodeSkill {
  const text = (field: "title" | "task" | "description" | "start") => i18n.t(`code.skills.${id}.${field}`);
  return {
    name,
    icon,
    needsGit,
    get title() {
      return text("title");
    },
    get task() {
      return text("task");
    },
    get description() {
      return text("description");
    },
    get prompt() {
      return start === "prompt" ? text("start") : undefined;
    },
    get hint() {
      return start === "hint" ? text("start") : undefined;
    },
  };
}

export const CODE_SKILLS: CodeSkill[] = [
  codeSkill("explain-project", "explainProject", BookOpen, "prompt"),
  codeSkill("code-review", "codeReview", ScanSearch, "prompt"),
  codeSkill("write-tests", "writeTests", FlaskConical, "hint"),
  codeSkill("debug", "debug", Bug, "hint"),
  codeSkill("refactor", "refactor", WandSparkles, "hint"),
  codeSkill("commit-and-pr", "commitAndPr", GitCommitHorizontal, "prompt", true),
  codeSkill("update-dependencies", "updateDependencies", Package, "prompt"),
  codeSkill("document-code", "documentCode", FileText, "hint"),
];

// The tasks a project's home offers, in this order
const HOME_TASKS = ["explain-project", "code-review", "write-tests", "debug", "commit-and-pr"];

export const codeSkillOf = (name: string | null | undefined) => CODE_SKILLS.find((s) => s.name === name) ?? null;

// The project's skills that are on and installed (a user could have none of them if Nyra's folder was damaged)
export const enabledCodeSkills = (disabled: string[], installed: string[]) =>
  CODE_SKILLS.filter((s) => !disabled.includes(s.name) && installed.includes(s.name));

// What a new conversation of the project starts with: the defaults for code, but not the ones the project turned off
export const projectDefaultSkills = (defaults: string[], disabled: string[], installed: string[]) =>
  defaults.filter((name) => !disabled.includes(name) && installed.includes(name));

export const homeTasks = (enabled: CodeSkill[]) => HOME_TASKS.flatMap((name) => enabled.filter((s) => s.name === name));

// Starting a task that needs nothing else: a new conversation of the project with the task's skill
export function taskSendOptions(task: CodeSkill, projectId: string, folder: WorkspaceFolder, skillNames: string[]) {
  return {
    skills: skillNames.includes(task.name) ? skillNames : [...skillNames, task.name],
    skill: task.name,
    taskSkill: task.name,
    workspace: folder,
    projectId,
    newConversation: true,
  } satisfies SendOptions;
}
