import { describe, expect, it } from "vitest";
import type { Conversation, Model } from "@/shared/types";
import {
  byProject,
  gitLabel,
  preferredModelOf,
  projectNameError,
  searchProjects,
  shortPath,
  shownPath,
  sortProjects,
} from "./projects";
import type { Project } from "./projectStorage";

const tienda: Project = {
  id: "p1",
  name: "Tienda web",
  path: "/proyectos/tienda",
  model: "ollama:qwen",
  disabledSkills: [],
};
const agenda: Project = { id: "p2", name: "agenda", path: "/proyectos/agenda", model: null, disabledSkills: [] };
const conversation = (id: string, title: string, projectId: string): Conversation => ({
  id,
  title,
  messages: [],
  projectId,
});
const conversations = [
  conversation("c1", "Arreglar el carrito", "p1"),
  conversation("c2", "Añadir pagos", "p1"),
  conversation("c3", "Recordatorios por correo", "p2"),
];

describe("searchProjects", () => {
  it("shows every project with its conversations when nothing is searched", () => {
    const shown = searchProjects([tienda, agenda], conversations, "  ");
    expect(shown.map((s) => s.conversations.length)).toEqual([2, 1]);
  });

  it("keeps a project whose name matches with all its conversations, ignoring case and accents", () => {
    const shown = searchProjects([tienda, agenda], conversations, "TIENDÁ");
    expect(shown).toEqual([{ project: tienda, conversations: conversations.slice(0, 2) }]);
  });

  it("keeps only the matching conversations of a project whose name doesn't match", () => {
    const shown = searchProjects([tienda, agenda], conversations, "pagos");
    expect(shown).toEqual([{ project: tienda, conversations: [conversations[1]] }]);
    expect(searchProjects([tienda, agenda], conversations, "zzz")).toEqual([]);
  });
});

describe("projects", () => {
  it("sorts by name", () => {
    expect(sortProjects([tienda, agenda]).map((p) => p.id)).toEqual(["p2", "p1"]);
  });

  it("ignores a preferred model that is no longer installed", () => {
    const qwen: Model = { id: "ollama:qwen", name: "Qwen", description: "", providerId: "ollama" };
    expect(preferredModelOf(tienda, [qwen])).toBe("ollama:qwen");
    expect(preferredModelOf(tienda, [])).toBeNull();
    expect(preferredModelOf(agenda, [qwen])).toBeNull();
  });

  it("only reports an empty name once the user tries to save", () => {
    expect(projectNameError("  ", false)).toBeNull();
    expect(projectNameError("  ", true)).toBe("Escribe un nombre para el proyecto.");
    expect(projectNameError("ñ".repeat(60), true)).toBeNull();
    expect(projectNameError("ñ".repeat(61), true)).toBe("Máximo 60 caracteres: sobran 1.");
  });
});

describe("how a project is shown", () => {
  it("starts a path inside the user's folder with ~, except on Windows", () => {
    expect(shortPath("/Users/marta/dev/tienda", "/Users/marta", false)).toBe("~/dev/tienda");
    expect(shortPath("/Users/marta", "/Users/marta/", false)).toBe("~");
    expect(shortPath("/Users/martina/dev", "/Users/marta", false)).toBe("/Users/martina/dev");
    expect(shortPath("C:\\Users\\marta\\dev", "C:\\Users\\marta", true)).toBe("C:\\Users\\marta\\dev");
    expect(shortPath("/srv/app", null, false)).toBe("/srv/app");
  });

  it("names the branch, says when there is no Git, and says nothing when git isn't installed", () => {
    expect(gitLabel({ kind: "repo", branch: "main", ahead: 2 })).toBe("main");
    expect(gitLabel({ kind: "notRepo" })).toBe("sin Git");
    expect(gitLabel({ kind: "unavailable" })).toBeNull();
    expect(gitLabel({ kind: "notTrusted" })).toBe("Git sin permiso");
    expect(gitLabel(null)).toBeNull();
  });
});

describe("byProject", () => {
  it("groups by project in one pass and leaves out what has none", () => {
    const groups = byProject(conversations, (c) => c.projectId);
    expect(groups.get("p1")?.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(groups.get("p2")?.map((c) => c.id)).toEqual(["c3"]);
    expect(byProject([{ projectId: null }], (x) => x.projectId).size).toBe(0);
  });
});

describe("shownPath", () => {
  it("hides only the mark of a name that isn't text", () => {
    expect(shownPath("\u0000docs/caf%E9.txt")).toBe("docs/caf%E9.txt");
    expect(shownPath("src/app.ts")).toBe("src/app.ts");
  });
});
