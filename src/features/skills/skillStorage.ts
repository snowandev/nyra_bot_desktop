import { invoke } from "@tauri-apps/api/core";
import type { DroppedFile, SkillCandidate, SkillDraft, SkillImportResult, SkillList } from "./skills";

export const listSkills = () => invoke<SkillList>("list_skills");
// original is the current name when editing, null when creating
export const saveSkill = (original: string | null, draft: SkillDraft) => invoke<void>("save_skill", { original, draft });
export const deleteSkill = (name: string) => invoke<void>("delete_skill", { name });
export const saveAdaptedSkill = (name: string, description: string, body: string) =>
  invoke<void>("save_adapted_skill", { name, description, body });
export const restoreOriginalSkill = (name: string) => invoke<void>("restore_original_skill", { name });
// The save dialog opens on the Rust side; null means the user cancelled it
export const exportSkill = (name: string) => invoke<string | null>("export_skill", { name });
// A file of an installed skill, to show a script before it runs
export const readSkillFile = (name: string, path: string) => invoke<string>("read_skill_file", { name, path });
// The files added and removed in the skill's form, once the skill is saved
export const updateSkillFiles = (name: string, added: DroppedFile[], removed: string[]) =>
  invoke<void>("update_skill_files", { name, added, removed });
export const scanClaudeCodeSkills = () => invoke<SkillCandidate[]>("scan_claude_code_skills");
export const pickSkillFolder = (fromClaudeCode: boolean) =>
  invoke<SkillCandidate[] | null>("pick_skill_folder", { fromClaudeCode });
export const pickSkillArchives = () => invoke<SkillCandidate[] | null>("pick_skill_archives");
export const stageDroppedSkills = (files: DroppedFile[]) =>
  invoke<SkillCandidate[]>("stage_dropped_skills", { files });
export const importSkills = (ids: string[], replace: string[] = []) =>
  invoke<SkillImportResult[]>("import_skills", { ids, replace });
