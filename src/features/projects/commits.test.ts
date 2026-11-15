import { describe, expect, it } from "vitest";
import { commitTitle, takeCommit, withoutCommitTag } from "./commits";

describe("commits", () => {
  it("takes the proposed message out of the reply", () => {
    const reply = "Estos son los cambios.\n\n<nyra-commit>\nAdd prices\n\nThe shop needs VAT.\n</nyra-commit>";
    expect(takeCommit(reply)).toEqual({ message: "Add prices\n\nThe shop needs VAT.", text: "Estos son los cambios." });
    expect(takeCommit("sin commit")).toEqual({ message: null, text: "sin commit" });
    expect(commitTitle("Add prices\n\nbody")).toBe("Add prices");
  });

  it("never shows the tag while it is written", () => {
    expect(withoutCommitTag("Listo.\n<nyra-commit>\nAdd pri")).toBe("Listo.\n");
    expect(withoutCommitTag("Listo.\n<nyra-com")).toBe("Listo.\n");
    expect(withoutCommitTag("a < b")).toBe("a < b");
  });
});
