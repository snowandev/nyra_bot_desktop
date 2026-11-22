import type { Skill } from "@/features/skills/skills";

// Commands that run a skill's own files, found by its folder in the command, with either kind of slash

const withSlashes = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

// The skill whose folder the command uses, and the file of it that it names, if that file is one of the skill's
export function skillScriptIn(command: string, skills: Skill[]): { skill: Skill; path: string | null } | null {
  const line = withSlashes(command);
  for (const skill of skills) {
    if (!skill.dir) continue;
    const dir = withSlashes(skill.dir);
    const at = line.indexOf(`${dir}/`);
    if (at === -1) continue;
    const named = line.slice(at + dir.length + 1).match(/^[^\s"'`]+/)?.[0] ?? null;
    const path = named && skill.files.some((f) => f.path === named) ? named : null;
    return { skill, path };
  }
  return null;
}

// A skill's folder written with either kind of slash
const anySlashes = (dir: string) =>
  new RegExp(
    withSlashes(dir)
      .split("/")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\\\/]"),
    "g",
  );

// The skills' folders made relative in a command, so using them isn't read as leaving the connected folder. Only
// they change: the rest keeps its slashes, so "C:\Users\…" is still seen as a path outside.
export function withoutSkillFolders(command: string, skills: Skill[]) {
  let line = command;
  for (const skill of skills) if (skill.dir) line = line.replace(anySlashes(skill.dir), ".");
  return line;
}
