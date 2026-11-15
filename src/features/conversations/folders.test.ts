import { describe, expect, it } from "vitest";
import { folderNameError, sortFolders } from "./folders";

const folders = [
  { id: "t", name: "Trabajo" },
  { id: "d", name: "Diseño" },
];

describe("folderNameError", () => {
  it("only reports an empty name after trying to save", () => {
    expect(folderNameError("  ", folders, null, false)).toBeNull();
    expect(folderNameError("  ", folders, null, true)).toBe("Escribe un nombre para la carpeta.");
  });

  it("rejects names taken ignoring case and accents", () => {
    expect(folderNameError("trabajo", folders, null, false)).toBe("Ya existe una carpeta llamada «trabajo».");
    expect(folderNameError("Diseno", folders, null, false)).not.toBeNull();
    // Renaming a folder to itself with other casing is fine
    expect(folderNameError("TRABAJO", folders, "t", true)).toBeNull();
  });

  it("limits the length", () => {
    expect(folderNameError("a".repeat(40), folders, null, true)).toBeNull();
    expect(folderNameError("a".repeat(43), folders, null, true)).toBe("Máximo 40 caracteres: sobran 3.");
  });
});

it("sorts folders alphabetically in Spanish", () => {
  expect(sortFolders([{ id: "1", name: "Trabajo" }, { id: "2", name: "Ñandú" }, { id: "3", name: "Nyra" }]).map((f) => f.name))
    .toEqual(["Nyra", "Ñandú", "Trabajo"]);
});
