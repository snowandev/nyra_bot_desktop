import { describe, expect, it } from "vitest";
import { compareVersions, mergeChangelogs, readChangelog, releaseBody, versionsBetween } from "./changelog";

const english = `# Changelog

Intro text that isn't part of any version.

## 0.9.1 · 2026-11-20

### New
- Imports the files of Claude Code conversations.

### Fixes
- A PDF that can't be read is now told.

## 0.9.0 - 2026-11-15

### New
- New icon.
`;

const spanish = `# Registro de cambios

## 0.9.1 · 2026-11-20

### Novedades
- Importa los archivos de las conversaciones de Claude Code.

### Arreglos
- Ahora avisa de un PDF que no se puede leer.

## 0.9.0 · 2026-11-15

### Novedades
- Nuevo icono.
`;

describe("the changelog", () => {
  it("joins both files by version, with each group in its language", () => {
    const { versions } = mergeChangelogs(english, spanish);
    expect(versions.map((v) => v.version)).toEqual(["0.9.1", "0.9.0"]);
    expect(versions[0].notes.en.new).toEqual(["Imports the files of Claude Code conversations."]);
    expect(versions[0].notes.es.fixes).toEqual(["Ahora avisa de un PDF que no se puede leer."]);
    expect(versions[0].notes.es.improvements).toEqual([]);
    expect(versions[1].date).toBe("2026-11-15");
  });

  it("fails when a version is missing or dated differently in the other language", () => {
    expect(() => mergeChangelogs(english, spanish.replace("## 0.9.0 · 2026-11-15", ""))).toThrow();
    expect(() => mergeChangelogs(english, spanish.replace("2026-11-15", "2026-11-16"))).toThrow(/different date/);
  });

  it("gives the versions between the installed one and the latest, newest first", () => {
    const changelog = mergeChangelogs(english, spanish);
    expect(versionsBetween(changelog, "0.8.2", "0.9.1").map((v) => v.version)).toEqual(["0.9.1", "0.9.0"]);
    expect(versionsBetween(changelog, "0.9.0", "0.9.1").map((v) => v.version)).toEqual(["0.9.1"]);
    expect(versionsBetween(changelog, "0.9.1", "0.9.1")).toEqual([]);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("only trusts a downloaded changelog with the expected shape", () => {
    const changelog = mergeChangelogs(english, spanish);
    expect(readChangelog(JSON.parse(JSON.stringify(changelog)))).toEqual(changelog);
    expect(readChangelog({ versions: [{ version: "1.0.0" }] })).toBeNull();
    expect(readChangelog("<html>")).toBeNull();
  });

  it("writes the release page with both languages and only the groups that have notes", () => {
    const body = releaseBody(mergeChangelogs(english, spanish), "0.9.1");
    expect(body).toContain("### New\n- Imports the files");
    expect(body).toContain("### Arreglos\n- Ahora avisa");
    expect(body).not.toContain("Improvements");
  });
});
