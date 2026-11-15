import { describe, expect, it } from "vitest";
import { stepsFor } from "./welcomeSteps";

describe("stepsFor", () => {
  it("sets up only where the user wants to run models", () => {
    expect(stepsFor({ local: true, cloud: false })).toEqual(["hello", "appearance", "where", "ollama", "mcp", "done"]);
    expect(stepsFor({ local: true, cloud: true })).toContain("cloud");
    expect(stepsFor({ local: false, cloud: false })).toEqual(["hello", "appearance", "where", "mcp", "done"]);
  });

  it("asks for the system's permissions only where some are left to ask", () => {
    expect(stepsFor({ local: false, cloud: false }, true)).toEqual(["hello", "appearance", "where", "mcp", "access", "done"]);
    expect(stepsFor({ local: false, cloud: false }, false)).not.toContain("access");
  });
});
