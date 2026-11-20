import { describe, expect, it } from "vitest";
import { CODE_SKILLS, codeSkillOf, enabledCodeSkills, homeTasks, projectDefaultSkills } from "./codeSkills";

const installed = CODE_SKILLS.map((s) => s.name);

describe("Código skills", () => {
  it("leaves out the ones turned off in the project and the ones not installed", () => {
    const enabled = enabledCodeSkills(
      ["debug"],
      installed.filter((n) => n !== "refactor"),
    );
    expect(enabled.map((s) => s.name)).not.toContain("debug");
    expect(enabled.map((s) => s.name)).not.toContain("refactor");
    expect(enabled).toHaveLength(CODE_SKILLS.length - 2);
  });

  it("starts a project's conversations with the code defaults the project keeps on and that are installed", () => {
    expect(
      projectDefaultSkills(
        ["writing", "debug", "code-review", "borrada"],
        ["debug"],
        [...installed, "writing"],
      ),
    ).toEqual(["writing", "code-review"]);
  });

  it("offers the home's five tasks in order, without the turned-off ones", () => {
    expect(homeTasks(enabledCodeSkills([], installed)).map((s) => s.name)).toEqual([
      "explain-project",
      "code-review",
      "write-tests",
      "debug",
      "commit-and-pr",
    ]);
    expect(homeTasks(enabledCodeSkills(["code-review"], installed))).toHaveLength(4);
  });

  it("gives each task either something to send or a hint for the composer", () => {
    expect(CODE_SKILLS.every((s) => !!s.prompt !== !!s.hint)).toBe(true);
    expect(codeSkillOf("commit-and-pr")?.needsGit).toBe(true);
    expect(codeSkillOf("summarize")).toBeNull();
  });
});
