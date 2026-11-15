import { describe, expect, it } from "vitest";
import { canFormat, formatCode } from "./codeFormat";

describe("canFormat", () => {
  it("knows each language by the names blocks and files use", () => {
    const names = ["python", "py", "TS", "tsx", "js", "css", "html", "sql", "postgresql", "yml", "golang", "c++", "cs", "java"];
    for (const name of [...names, "toml"]) {
      expect(canFormat(name), name).toBe(true);
    }
  });

  it("offers nothing for a language without a formatter, nor for no language", () => {
    expect(canFormat("rust")).toBe(false);
    expect(canFormat("txt")).toBe(false);
    expect(canFormat(null)).toBe(false);
  });

  it("says so when asked to format a language it doesn't have", async () => {
    await expect(formatCode("fn main() {}", "rust")).rejects.toThrow();
  });
});
