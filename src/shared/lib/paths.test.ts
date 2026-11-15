import { expect, it } from "vitest";
import { fileName, folderPrefix, splitPath } from "./paths";

it("splits a path into its folders and its name", () => {
  expect(fileName("src/app/main.tsx")).toBe("main.tsx");
  expect(fileName("README.md")).toBe("README.md");
  expect(folderPrefix("src/app/main.tsx")).toBe("src/app/");
  expect(folderPrefix("README.md")).toBe("");
  expect(splitPath("src/app/main.tsx")).toEqual({ name: "main.tsx", folder: "src/app" });
  expect(splitPath("README.md")).toEqual({ name: "README.md", folder: "" });
});
