import { describe, expect, it } from "vitest";
import type { Attachment, Message } from "@/shared/types";
import { fileStatesOf, historyForModel, planSummary, summaryRequest, summaryStillValid, trimToTokens } from "./summary";

// 3 characters count as one token, so each of these messages weighs `tokens` tokens
const message = (role: Message["role"], tokens: number, extra: Partial<Message> = {}): Message => ({
  role,
  content: "x".repeat(tokens * 3),
  ...extra,
});

const file = (id: string): Attachment => ({ id, kind: "text", name: `${id}.txt`, mimeType: "text/plain", data: "" });

describe("planSummary", () => {
  // A 1000-token context leaves 500 for everything after summarizing, 350 of them for recent messages
  const sixMessages = [0, 1, 2, 3, 4, 5].map((i) => message(i % 2 === 0 ? "user" : "assistant", 100));

  it("keeps the latest exchanges that fit in the recent budget and gives the rest to the summary", () => {
    expect(planSummary(sixMessages, undefined, 1000)).toEqual({ cut: 4, maxTokens: 300 });
  });

  it("summarizes everything when even the last exchange doesn't fit", () => {
    const messages = [message("user", 30), message("assistant", 30), message("user", 700)];
    expect(planSummary(messages, undefined, 1000)).toEqual({ cut: 3, maxTokens: 500 });
  });

  it("returns null when everything since the last summary already fits", () => {
    expect(planSummary(sixMessages, { text: "s", fromIndex: 4 }, 1000)).toBeNull();
  });

  it("leaves room for the tokens every request carries, and gives up when there is none", () => {
    expect(planSummary(sixMessages, undefined, 1000, 50)?.maxTokens).toBeLessThan(300);
    expect(planSummary(sixMessages, undefined, 1000, 500)).toBeNull();
  });

  it("caps the summary in a large context, where keeping messages verbatim says more", () => {
    const long = [0, 1, 2, 3].map((i) => message(i % 2 === 0 ? "user" : "assistant", 200_000));
    expect(planSummary(long, undefined, 1_000_000)?.maxTokens).toBe(6000);
  });

  it("by hand, keeps only the latest exchange even when more would fit", () => {
    const short = [0, 1, 2, 3].map((i) => message(i % 2 === 0 ? "user" : "assistant", 10));
    expect(planSummary(short, undefined, 1000)).toBeNull();
    expect(planSummary(short, undefined, 1000, 0, true)?.cut).toBe(2);
  });

  it("by hand, has nothing to compact with a single exchange since the last summary", () => {
    const one = [message("user", 10), message("assistant", 10)];
    expect(planSummary(one, undefined, 1000, 0, true)).toBeNull();
  });

  it("counts a referenced file as much as an attached one", () => {
    const heavy: Attachment = { ...file("big"), data: "x".repeat(1200) };
    const messages = [
      message("user", 10, { attachments: [heavy] }),
      message("assistant", 10),
      message("user", 10, { references: ["big"] }),
      message("assistant", 10),
    ];
    // Resolved, the reference adds 400 tokens to the last exchange, so it no longer fits in 350
    expect(planSummary(messages, undefined, 1000)?.cut).toBe(4);
  });
});

describe("summaryRequest", () => {
  const plan = { cut: 4, maxTokens: 300 };

  it("sends the files cut to their start and images by name", () => {
    const messages = [
      { role: "user" as const, content: "Revisa esto", attachments: [{ ...file("datos"), data: "a".repeat(5000) }] },
      { role: "assistant" as const, content: "Listo" },
      { role: "user" as const, content: "¿Y la foto?", attachments: [{ ...file("foto"), kind: "image" as const, name: "foto.png" }] },
      { role: "assistant" as const, content: "Es un gato" },
    ];
    const [request] = summaryRequest(messages, undefined, plan);
    expect(request.content).toContain("[File: datos.txt]");
    expect(request.content).not.toContain("a".repeat(2001));
    expect(request.content).toContain("[Image: foto.png]");
    expect(request.content).toContain("Es un gato");
  });

  it("updates the previous summary with only the messages after it", () => {
    const messages = ["viejo", "viejo", "nuevo", "nuevo"].map((content, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${content}-${i}`,
    }));
    const [request] = summaryRequest(messages, { text: "RESUMEN ANTERIOR", fromIndex: 2 }, plan);
    expect(request.content).toContain("RESUMEN ANTERIOR");
    expect(request.content).not.toContain("viejo");
    expect(request.content).toContain("nuevo-2");
  });

  it("says what the replies read in the folder and what happened to their changes", () => {
    const change = { id: "c", root: "/r", path: "src/app.py", kind: "edit" as const, blocks: [] };
    const messages: Message[] = [
      message("user", 1),
      {
        role: "assistant",
        content: "Cambiado",
        workspaceConsult: {
          folder: "r",
          root: "/r",
          read: [{ path: "src/app.py", size: 1, modified: 1 }],
          searches: [],
          listed: [],
          skipped: [],
          tokens: 1,
          budget: 1,
        },
        workspaceChanges: [{ ...change, status: "applied" }, { ...change, path: "README.md", status: "discarded" }],
      },
    ];
    const [request] = summaryRequest(messages, undefined, { cut: 2, maxTokens: 100 });
    expect(request.content).toContain("Read in the folder: src/app.py");
    expect(request.content).toContain("edit src/app.py (applied)");
    expect(request.content).toContain("edit README.md (discarded by the user)");
  });
});

describe("historyForModel", () => {
  it("sends the summary first and only the messages after it", () => {
    const messages = [message("user", 1), message("assistant", 1), message("user", 1), message("assistant", 1)];
    const history = historyForModel(messages, { text: "RESUMEN", fromIndex: 2 });
    expect(history).toHaveLength(3);
    expect(history[0].content).toContain("RESUMEN");
    expect(history.slice(1)).toEqual(messages.slice(2));
  });

  it("resolves references to files that were summarized away", () => {
    const messages = [
      message("user", 1, { attachments: [file("a")] }),
      message("assistant", 1),
      message("user", 1, { references: ["a"] }),
    ];
    const history = historyForModel(messages, { text: "s", fromIndex: 2 });
    expect(history[1].attachments?.map((a) => a.id)).toEqual(["a"]);
  });
});

describe("fileStatesOf", () => {
  it("tells complete, summarized and referenced files apart", () => {
    const messages = [
      message("user", 1, { attachments: [file("a"), file("c")] }),
      message("assistant", 1),
      message("user", 1, { attachments: [file("b")] }),
      message("user", 1, { references: ["a"] }),
    ];
    const states = fileStatesOf(messages, { text: "s", fromIndex: 2 });
    expect(Object.fromEntries(states)).toEqual({ a: "referenced", c: "summarized", b: "complete" });
  });
});

describe("summaryStillValid", () => {
  const summary = { text: "s", fromIndex: 4 };

  it("keeps the summary when the change comes after the summarized part", () => {
    expect(summaryStillValid(summary, 4)).toBe(summary);
    expect(summaryStillValid(summary, 9)).toBe(summary);
  });

  it("drops it when a summarized message changes", () => {
    expect(summaryStillValid(summary, 3)).toBeUndefined();
  });
});

describe("trimToTokens", () => {
  it("leaves short text alone", () => {
    expect(trimToTokens("Hola.", 10)).toBe("Hola.");
  });

  it("cuts at the last sentence end that fits", () => {
    expect(trimToTokens("Hola mundo. Esto es largo y sigue.", 5)).toBe("Hola mundo.");
  });
});
