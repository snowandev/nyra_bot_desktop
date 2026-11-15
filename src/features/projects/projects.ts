import { i18n } from "@/shared/i18n/i18n";
import { foldForSearch } from "@/shared/lib/search";
import type { Conversation, Model, WorkspaceFolder } from "@/shared/types";
import type { GitState, Project } from "./projectStorage";

// Alphabetical: predictable, and no positions to manage
export const sortProjects = (projects: Project[]) => [...projects].sort((a, b) => a.name.localeCompare(b.name, "es"));

// The folder every conversation of the project works in
export const folderOf = (project: Project): WorkspaceFolder => ({ path: project.path, name: project.name });

// A preferred model that was uninstalled since is ignored, like the app's default
export const preferredModelOf = (project: Project, models: Model[]) =>
  models.some((m) => m.id === project.model) ? project.model : null;

// Newest first, as the conversations list already comes; private ones never belong to a project
export const conversationsOf = (projectId: string, conversations: Conversation[]) =>
  conversations.filter((c) => c.projectId === projectId);

// Things of the projects by project, in one pass: the sidebar asks for each project's on every render
export function byProject<T>(items: T[], projectOf: (item: T) => string | null | undefined) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = projectOf(item);
    if (id) groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  return groups;
}

// While searching, a project shows when its name matches, with all its conversations, or only the conversations
// whose title matches
export function searchProjects(projects: Project[], conversations: Conversation[], query: string) {
  const folded = foldForSearch(query.trim());
  return projects.flatMap((project) => {
    const inside = conversationsOf(project.id, conversations);
    if (!folded) return [{ project, conversations: inside }];
    if (foldForSearch(project.name).includes(folded)) return [{ project, conversations: inside }];
    const matching = inside.filter((c) => foldForSearch(c.title).includes(folded));
    return matching.length > 0 ? [{ project, conversations: matching }] : [];
  });
}

// The same limit as the Rust side, which checks it again
export const PROJECT_NAME_MAX = 60;
export const PROJECT_COUNTER_FROM = 45;

// "Empty" is only reported once the user tries to save. Unlike sidebar folders, two projects may share a name: each
// is a different folder of the computer.
export function projectNameError(name: string, hasTriedToSave: boolean) {
  const trimmed = name.trim();
  if (!trimmed) return hasTriedToSave ? i18n.t("projects.name.required") : null;
  const length = Array.from(trimmed).length;
  return length > PROJECT_NAME_MAX
    ? i18n.t("projects.name.tooLong", { max: PROJECT_NAME_MAX, extra: length - PROJECT_NAME_MAX })
    : null;
}

// Inside the user's folder a path starts with ~, as macOS and Linux show it; on Windows that sign means nothing
export function shortPath(path: string, home: string | null, onWindows: boolean) {
  if (!home || onWindows) return path;
  const base = home.replace(/[\\/]+$/, "");
  if (path === base) return "~";
  const next = path[base.length];
  return path.startsWith(base) && (next === "/" || next === "\\") ? `~${path.slice(base.length)}` : path;
}

// A path of git as the user reads it. A name that isn't text (only possible on Linux) comes with its odd bytes
// escaped (%E9) after a NUL that marks it, and must go back to Rust exactly so; only the mark is hidden.
export const shownPath = (path: string) => (path.startsWith("\u0000") ? path.slice(1) : path);

// How a project's Git is told in its row and its home; null when there is nothing to say (no git installed)
export function gitLabel(git: GitState | null) {
  if (git?.kind === "repo") return git.branch;
  if (git?.kind === "notRepo") return i18n.t("projects.git.none");
  if (git?.kind === "notTrusted") return i18n.t("projects.git.notTrusted");
  return null;
}
