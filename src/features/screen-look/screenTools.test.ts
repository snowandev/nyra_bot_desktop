import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenRecord } from "@/shared/types";
import { answerGuide, answerLook } from "./screenSession";
import { actionOf, pointOf, screenTools } from "./screenTools";

const storage = vi.hoisted(() => ({
  screenLook: vi.fn(),
  screenZoom: vi.fn(),
  screenOverview: vi.fn(),
  screenCloseUp: vi.fn(),
  screenMark: vi.fn(),
  screenClear: vi.fn(),
  screenWatch: vi.fn(),
  screenWatchStop: vi.fn(),
  onScreenMarks: vi.fn(),
  screenAct: vi.fn(),
  screenActEnd: vi.fn(),
  screenActThinking: vi.fn(),
}));
vi.mock("./screenStorage", () => storage);
let conversation = 0;

// By default the model finds things: first around the middle, then filling the zoom
const finds = async (image: string): Promise<string> => (image === "whole" ? "[400,400,600,600]" : "[0,0,1000,1000]");

function tools(see: (image: string) => Promise<string> = finds, signal = new AbortController().signal) {
  let record: ScreenRecord | null = null;
  const id = `s${++conversation}`;
  const screen = screenTools({
    conversationId: id,
    signal,
    see,
    boxFormat: "thousandths",
    offset: () => 3,
    onRecord: (next) => (record = next),
  });
  return { id, screen, card: () => record };
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.screenLook.mockResolvedValue({ image: "whole", width: 1600, height: 900 });
  storage.screenZoom.mockResolvedValue({
    image: "zoomed",
    area: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    width: 800,
    height: 450,
  });
  storage.screenCloseUp.mockResolvedValue("closeup");
  storage.screenOverview.mockResolvedValue(null);
  storage.screenMark.mockResolvedValue(undefined);
  storage.screenClear.mockResolvedValue(undefined);
  storage.onScreenMarks.mockResolvedValue(() => {});
  storage.screenWatchStop.mockResolvedValue(undefined);
  storage.screenAct.mockResolvedValue("done");
  storage.screenActEnd.mockResolvedValue(undefined);
  storage.screenActThinking.mockResolvedValue(undefined);
});

// The question shows on the strip above the composer; the user answers it there
async function answerWhenAsked(id: string, yes: boolean) {
  await vi.waitFor(() => expect(storage.screenLook).not.toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  answerLook(id, yes);
}

describe("pointOf", () => {
  it("reads what to point at, an arrow, and the note", () => {
    expect(pointOf("the 'Wi-Fi' item | Click here")).toEqual({ what: "the 'Wi-Fi' item", note: "Click here" });
    expect(pointOf("the menu -> the 'Save' button | Then here")).toEqual({
      what: "the 'Save' button",
      from: "the menu",
      note: "Then here",
    });
    expect(pointOf("clear")).toEqual({ clear: true });
    expect(pointOf(" | note")).toBeNull();
  });
});

describe("actionOf", () => {
  it("reads a click, its note and how it presses", () => {
    expect(actionOf("screenClick", "the 'Save' button | Saving")).toEqual({
      kind: "click",
      what: "the 'Save' button",
      note: "Saving",
      press: "left",
    });
    expect(actionOf("screenClick", "the file | Opening it | double")).toMatchObject({ note: "Opening it", press: "double" });
    expect(actionOf("screenClick", "the file | Right")).toMatchObject({ note: "Right", press: "left" });
    expect(actionOf("screenClick", " | note")).toBeNull();
  });

  it("reads a scroll by its direction and lines", () => {
    expect(actionOf("screenScroll", "the list | up 3")).toEqual({ kind: "scroll", what: "the list", lines: -3, horizontal: false });
    expect(actionOf("screenScroll", "the table | right")).toMatchObject({ lines: 5, horizontal: true });
    expect(actionOf("screenScroll", "the page | down 500")).toMatchObject({ lines: 30 });
    expect(actionOf("screenScroll", "the page | sideways")).toBeNull();
  });

  it("reads typing alone, into a field, and with Enter after it", () => {
    expect(actionOf("screenType", "  Hola mundo ")).toEqual({ kind: "type", text: "Hola mundo", enter: false });
    expect(actionOf("screenType", "the search field | gatos | enter")).toEqual({
      kind: "type",
      what: "the search field",
      text: "gatos",
      enter: true,
    });
    expect(actionOf("screenType", "the name field | Marta")).toMatchObject({ what: "the name field", enter: false });
    expect(actionOf("screenType", "gatos | Enter")).toEqual({ kind: "type", text: "gatos", enter: true });
    expect(actionOf("screenType", "  ")).toBeNull();
    expect(actionOf("screenType", "the field | ")).toBeNull();
  });

  it("reads keys", () => {
    expect(actionOf("screenKey", "cmd+s")).toEqual({ kind: "key", keys: "cmd+s" });
  });
});

describe("screenTools", () => {
  it("asks once for the task before acting, clicks what it found and looks again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { id, screen, card } = tools();
    const clicking = screen.run("screenClick", "the 'Save' button | Saving");
    await answerWhenAsked(id, true);
    const seen = await clicking;
    expect(storage.screenAct).toHaveBeenCalledWith(id, expect.objectContaining({ kind: "click", press: "left", note: "Saving" }));
    expect(seen.attachments?.[0]).toMatchObject({ data: "whole" });
    await screen.run("screenKey", "enter");
    expect(storage.screenAct).toHaveBeenCalledTimes(2);
    expect(card()?.steps.map((s) => s.outcome)).toEqual(["ok", "ok"]);
    // Between steps the pointer says the next one is being worked out
    expect(storage.screenActThinking).toHaveBeenCalledTimes(2);
    screen.close();
    // Finished by itself, the pointer first says where the answer is
    expect(storage.screenActEnd).toHaveBeenCalledWith(id, expect.any(String));
    vi.useRealTimers();
  });

  it("stopping the reply takes the pointer away while an action is on its way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const controller = new AbortController();
    const { id, screen } = tools(finds, controller.signal);
    // The pointer is still gliding to the button when the user stops the reply
    let arrive: (acted: "done" | "stopped") => void = () => {};
    storage.screenAct.mockReturnValueOnce(new Promise((resolve) => (arrive = resolve)));
    const clicking = screen.run("screenClick", "the 'Send' button | Sending");
    await answerWhenAsked(id, true);
    await vi.waitFor(() => expect(storage.screenAct).toHaveBeenCalledTimes(1));
    controller.abort();
    // Right away, as «Detener» on the strip does, not once the action ends
    expect(storage.screenActEnd).toHaveBeenCalledWith(id, null);
    // The click didn't happen: the pointer left, so the action ends as stopped
    arrive("stopped");
    expect((await clicking).content).toContain("stopped you");
    vi.useRealTimers();
  });

  it("doesn't type or press keys while the keyboard is in Nyra, and says to click in the user's app first", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { id, screen, card } = tools();
    storage.screenAct.mockResolvedValueOnce("ownKeyboard");
    const typing = screen.run("screenType", "hello");
    await answerWhenAsked(id, true);
    expect((await typing).content).toContain("keyboard is in Nyra's own window");
    expect(card()?.steps[0].outcome).toBe("inNyra");
    // Not a stop: the next action, once it clicked in the user's app, goes ahead
    await screen.run("screenClick", "the search field | Searching");
    expect(storage.screenAct).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("stops acting for the rest of the reply once the user stops it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { id, screen, card } = tools();
    storage.screenAct.mockResolvedValueOnce("stopped");
    const clicking = screen.run("screenClick", "the menu | Opening it");
    await answerWhenAsked(id, true);
    expect((await clicking).content).toContain("stopped you");
    expect((await screen.run("screenType", "hello")).content).toContain("stopped you");
    expect(storage.screenAct).toHaveBeenCalledTimes(1);
    expect(card()?.steps.map((s) => s.outcome)).toEqual(["taken", "taken"]);
    vi.useRealTimers();
  });

  it("asks once per conversation before looking, and shows the model the screen", async () => {
    const { id, screen, card } = tools();
    const looking = screen.run("look", "");
    await answerWhenAsked(id, true);
    const seen = await looking;
    expect(seen.attachments?.[0]).toMatchObject({ kind: "image", data: "whole" });
    await screen.run("look", "");
    expect(storage.screenLook).toHaveBeenCalledTimes(2);
    expect(card()?.steps.map((s) => s.outcome)).toEqual(["ok", "ok"]);
  });

  it("points at what it found, with a close-up for the model to check", async () => {
    const { id, screen } = tools();
    const looking = screen.run("look", "");
    await answerWhenAsked(id, true);
    await looking;
    const marked = await screen.run("point", "the 'Save' button | Click here");
    const [, marks] = storage.screenMark.mock.calls[0];
    expect(marks).toEqual([{ number: 1, area: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, note: "Click here" }]);
    expect(marked.content).toContain("mark 1");
    expect(marked.attachments?.[0].data).toBe("closeup");
  });

  it("goes on without the screen when the user says no, and doesn't ask again in the reply", async () => {
    const { id, screen, card } = tools();
    const looking = screen.run("look", "");
    await answerWhenAsked(id, false);
    expect((await looking).content).toContain("didn't allow");
    expect((await screen.run("point", "x | y")).content).toContain("didn't allow");
    expect(storage.screenLook).not.toHaveBeenCalled();
    expect(card()?.steps.at(-1)?.outcome).toBe("refused");
  });

  it("says when it can't find what to point at", async () => {
    const { id, screen } = tools(async () => "I don't see it");
    const pointing = screen.run("point", "the 'Teleport' button | here");
    await answerWhenAsked(id, true);
    expect((await pointing).content).toContain("Couldn't find");
    expect(storage.screenMark).not.toHaveBeenCalled();
  });
});

describe("a guide", () => {
  // Looked and pointed at the first step, with the screen allowed
  async function onFirstStep() {
    const t = tools();
    const looking = t.screen.run("look", "");
    await answerWhenAsked(t.id, true);
    await looking;
    await t.screen.run("point", "the 'Display' item | Open this");
    return t;
  }

  it("waits for the user to do the step near the marks, then gives the new screen", async () => {
    const { screen, card } = await onFirstStep();
    storage.screenWatch.mockResolvedValue({ kind: "changed", view: { image: "after", width: 1600, height: 900 } });
    const next = await screen.run("watch", "Click Display");
    const [, , near] = storage.screenWatch.mock.calls[0];
    expect(near.x).toBeCloseTo(0.4);
    expect(near.width).toBeCloseTo(0.2);
    expect(next.content).toContain('step="1"');
    expect(next.content).toContain("The screen changed");
    expect(next.attachments?.[0].data).toBe("after");
    // The old marks went: the screen they were on changed
    expect(storage.screenClear).toHaveBeenCalled();
    expect(card()?.steps.at(-1)).toMatchObject({ kind: "watch", target: "Click Display", outcome: "ok" });
  });

  it("goes on when the user says they did it, with a fresh look", async () => {
    const { id, screen, card } = await onFirstStep();
    storage.screenWatch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ kind: "stopped" }), 20)),
    );
    const waiting = screen.run("watch", "Click Display");
    await new Promise((resolve) => setTimeout(resolve, 0));
    answerGuide(id, "done");
    const next = await waiting;
    const [run] = storage.screenWatch.mock.calls[0].slice(1);
    expect(storage.screenWatchStop).toHaveBeenCalledWith(run);
    expect(next.content).toContain("The user says they did it");
    expect(card()?.steps.at(-1)?.outcome).toBe("done");
  });

  it("ends when the user ends it, also before Nyra waits", async () => {
    const { id, screen, card } = await onFirstStep();
    answerGuide(id, "end");
    const ended = await screen.run("watch", "Click Display");
    expect(storage.screenWatch).not.toHaveBeenCalled();
    expect(ended.content).toContain("The user ended the guide");
    expect(card()?.steps.at(-1)?.outcome).toBe("ended");
    screen.close();
  });

  it("stops after a long while without changes", async () => {
    const { screen } = await onFirstStep();
    storage.screenWatch.mockResolvedValue({ kind: "idle" });
    expect((await screen.run("watch", "Click Display")).content).toContain("5 minutes");
  });
});
