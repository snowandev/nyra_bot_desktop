import { describe, expect, it } from "vitest";
import type { Skill } from "@/features/skills/skills";
import { commandRisk } from "./commandRisks";
import { skillScriptIn, withoutSkillFolders } from "./skillScripts";

const pdf = {
  name: "pdf",
  dir: "/datos/nyra/skills/pdf",
  files: [
    { path: "SKILL.md", size: 10 },
    { path: "scripts/extraer.py", size: 40 },
  ],
} as Skill;
const windows = { ...pdf, dir: "C:\\Datos\\nyra\\skills\\pdf" } as Skill;

describe("skillScriptIn", () => {
  it("finds the skill and its script in the command", () => {
    expect(skillScriptIn('python3 "/datos/nyra/skills/pdf/scripts/extraer.py" informe.pdf', [pdf])).toEqual({
      skill: pdf,
      path: "scripts/extraer.py",
    });
  });

  it("works with Windows paths written with either slash", () => {
    expect(skillScriptIn('py "C:\\Datos\\nyra\\skills\\pdf\\scripts\\extraer.py"', [windows])?.path).toBe("scripts/extraer.py");
    expect(skillScriptIn("py C:/Datos/nyra/skills/pdf/scripts/extraer.py", [windows])?.path).toBe("scripts/extraer.py");
  });

  it("names no script when the file isn't one of the skill's, and nothing for other commands", () => {
    expect(skillScriptIn("cat /datos/nyra/skills/pdf/otro.txt", [pdf])?.path).toBeNull();
    expect(skillScriptIn("npm test", [pdf])).toBeNull();
  });
});

it("makes the skills' folders relative before looking for paths outside the connected folder", () => {
  expect(withoutSkillFolders('python3 "/datos/nyra/skills/pdf/scripts/extraer.py" a.pdf', [pdf])).toBe('python3 "./scripts/extraer.py" a.pdf');
  expect(withoutSkillFolders("python C:/Datos/nyra/skills/pdf/scripts/extraer.py", [windows])).toBe(
    "python ./scripts/extraer.py",
  );
});

it("still sees a Windows path outside the connected folder when skills are around", () => {
  for (const command of ["type C:\\Users\\Marta\\notas.txt", "type C:/Users/Marta/notas.txt"]) {
    const risk = commandRisk(command, withoutSkillFolders(command, [windows, pdf]));
    expect(risk?.kind, command).toBe("outside");
    expect(risk?.mark, command).toMatch(/^C:/);
  }
  const ownScript = "python C:\\Datos\\nyra\\skills\\pdf\\scripts\\extraer.py";
  expect(commandRisk(ownScript, withoutSkillFolders(ownScript, [windows]))).toBeNull();
});
