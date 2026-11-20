// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import "@/shared/i18n/i18n";
import { applyLanguage } from "@/shared/i18n/i18n";
import type { Attachment } from "@/shared/types";

const storage = vi.hoisted(() => ({ playableAudio: vi.fn() }));
vi.mock("./transcriptionStorage", () => storage);

const { AudioPlayer } = await import("./AudioPlayer");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
applyLanguage("es");

const audio: Attachment = { id: "a1", kind: "audio", name: "Entrevista.M4A", mimeType: "audio/mp4", data: "" };

async function render() {
  const box = document.createElement("div");
  await act(async () => createRoot(box).render(<AudioPlayer audio={audio} />));
  return box;
}

describe("playing an attached audio", () => {
  it("plays it from its stored file", async () => {
    storage.playableAudio.mockResolvedValue("asset://localhost/a1.m4a");
    const box = await render();
    expect(storage.playableAudio).toHaveBeenCalledWith("a1", "m4a");
    expect(box.querySelector("audio")?.getAttribute("src")).toBe("asset://localhost/a1.m4a");
  });

  it("says why when its file is gone", async () => {
    storage.playableAudio.mockRejectedValue("El audio ya no está.");
    const box = await render();
    expect(box.querySelector("audio")).toBeNull();
    expect(box.querySelector('[role="alert"]')?.textContent).toBe("El audio ya no está.");
  });
});
