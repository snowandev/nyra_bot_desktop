import { invoke } from "@tauri-apps/api/core";

// Projects are stored by the Rust side, next to the conversations; it validates names again

export type Project = {
  id: string;
  name: string;
  path: string;
  // The model new conversations of the project start with; null uses the app's default
  model: string | null;
  // Skills of the Código space turned off in this project; any other is on
  disabledSkills: string[];
};

export const listProjects = () => invoke<Project[]>("list_projects");
// A folder that was a project before comes back with its id and its conversations
export const addProject = (id: string, path: string, name: string) =>
  invoke<Project>("add_project", { id, path, name });
// Resolves to the name as stored (trimmed)
export const renameProject = (id: string, name: string) => invoke<string>("rename_project", { id, name });
export const setProjectModel = (id: string, model: string | null) => invoke<void>("set_project_model", { id, model });
export const setProjectDisabledSkills = (id: string, names: string[]) =>
  invoke<void>("set_project_disabled_skills", { id, names });
// Only out of the list: the folder and the conversations stay
export const removeProject = (id: string) => invoke<void>("remove_project", { id });

export type GitState =
  // ahead: commits not pushed yet; null when the branch follows no remote one
  | { kind: "repo"; branch: string; ahead: number | null }
  | { kind: "notRepo" }
  // Git refuses the folder because it belongs to another user (an external disk, a network share)
  | { kind: "notTrusted" }
  // Git isn't installed, or can't be found
  | { kind: "unavailable" };

export type ProjectStatus = {
  // The folder isn't where it was: moved, renamed, deleted or on a disconnected disk
  missing: boolean;
  git: GitState | null;
};

export const projectStatus = (root: string) => invoke<ProjectStatus>("project_status", { root });
export const initProjectGit = (root: string) => invoke<void>("init_project_git", { root });
// The new place must have been picked first; the project's conversations follow it
export const relocateProject = (id: string, path: string) => invoke<Project>("relocate_project", { id, path });
// Undoing "Quitar de la lista"
export const restoreProject = (id: string) => invoke<Project>("restore_project", { id });

// Something in a project's conversation waiting for the user, as saved on disk
export type PendingItem = {
  projectId: string;
  conversationId: string;
  messageIndex: number;
  // A commit proposed and not made yet is pending too
  kind: "change" | "command" | "commit";
  id: string;
  // The file of a change, the command line of a command, the message of a commit
  label: string;
  // A change that creates the file
  isNew: boolean;
};

export type GitChange = {
  path: string;
  status: "A" | "M" | "D";
  // null for a binary file or one too large to count
  added: number | null;
  removed: number | null;
};

type GitDiff = {
  // A unified diff, or the whole file when it is new
  text: string;
  wholeFile: boolean;
  // Binary or too large to show
  unavailable: boolean;
};

export const projectsPending = () => invoke<PendingItem[]>("projects_pending");
// files stops at a few hundred; total counts them all
export const projectGitChanges = (root: string) =>
  invoke<{ files: GitChange[]; total: number }>("project_git_changes", { root });
export const projectGitDiff = (root: string, path: string, status: GitChange["status"]) =>
  invoke<GitDiff>("project_git_diff", { root, path, status });
// The commit the user approved on its card: only the given files, never a push. Resolves to its short id.
export const projectCommit = (root: string, message: string, paths: string[]) =>
  invoke<string>("project_commit", { root, message, paths });
