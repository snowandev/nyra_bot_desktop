import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@/shared/types";
import { configForModel, deliverByFrame, frameBuffer } from "./modelRequest";

describe("configForModel", () => {
  const model: Model = { id: "m", name: "m", description: "", providerId: "ollama", contextWindow: 8192 };

  it("caps the chosen context at the model's maximum", () => {
    expect(configForModel({ baseUrl: "", apiKey: "", contextLength: 32768 }, model).contextLength).toBe(8192);
    expect(configForModel({ baseUrl: "", apiKey: "", contextLength: 4096 }, model).contextLength).toBe(4096);
  });

  it("leaves it alone when the user didn't choose one", () => {
    const config = { baseUrl: "", apiKey: "" };
    expect(configForModel(config, model)).toBe(config);
  });
});

describe("deliverByFrame", () => {
  // Frames run only when the test says so, to see exactly what each one delivers
  let frames: FrameRequestCallback[];
  const runFrame = () => frames.splice(0).forEach((callback) => callback(0));

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames[id - 1] = () => {};
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins the tokens of a frame into one delivery and hands over the rest at the end", async () => {
    const delivered: string[] = [];
    const { result, received } = await deliverByFrame(async (onToken) => {
      onToken("Ho");
      onToken("la");
      runFrame();
      onToken(" mundo");
      return "usage";
    }, (text) => delivered.push(text));

    expect(delivered).toEqual(["Hola", " mundo"]);
    expect(result).toBe("usage");
    expect(received).toBe(true);
  });

  it("still delivers what arrived when the request fails", async () => {
    const delivered: string[] = [];
    const failing = deliverByFrame(async (onToken) => {
      onToken("parcial");
      throw new Error("se cortó");
    }, (text) => delivered.push(text));

    await expect(failing).rejects.toThrow("se cortó");
    expect(delivered).toEqual(["parcial"]);
  });

  it("drops text not painted yet when asked to", () => {
    const delivered: string[] = [];
    const buffer = frameBuffer((text) => delivered.push(text));
    buffer.push("Déjame buscarlo.");
    buffer.discard();
    buffer.push("Respuesta");
    buffer.end();
    expect(delivered).toEqual(["Respuesta"]);
  });

  it("reports when nothing arrived", async () => {
    const { received } = await deliverByFrame(async () => undefined, () => {});
    expect(received).toBe(false);
  });
});
