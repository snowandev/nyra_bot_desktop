// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/shared/i18n/i18n";
import { applyLanguage } from "@/shared/i18n/i18n";

const storage = vi.hoisted(() => ({
  startMeetingRecording: vi.fn(),
  stopMeetingRecording: vi.fn(),
  discardMeetingRecording: vi.fn(),
  onMeetingEnded: vi.fn(async () => () => {}),
}));
vi.mock("./meetingStorage", () => storage);

const { meetingAttachment, record, stopRecording, useMeeting } = await import("./meetingRecorder");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
applyLanguage("es");

// What a box on screen reads
function renderPhase() {
  const seen: string[] = [];
  function Probe() {
    seen.push(useMeeting().phase);
    return null;
  }
  act(() => createRoot(document.createElement("div")).render(<Probe />));
  return () => seen.at(-1);
}

describe("recording a meeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records at once and gives the recording to attach when it stops", async () => {
    const phase = renderPhase();
    storage.startMeetingRecording.mockResolvedValue({ systemError: null });
    storage.stopMeetingRecording.mockResolvedValue({ id: "r1", duration: 65 });
    await act(async () => record());
    expect(phase()).toBe("recording");
    let audio: Awaited<ReturnType<typeof stopRecording>> = null;
    await act(async () => {
      audio = await stopRecording();
    });
    expect(phase()).toBe("idle");
    expect(audio).toMatchObject({ id: "r1", kind: "audio", duration: 65, meeting: true });
  });

  it("names the recording after when it started", () => {
    const audio = meetingAttachment({ id: "r2", duration: 10 }, new Date(2026, 2, 5, 9, 7));
    expect(audio.name).toBe("Reunión 2026-03-05 09.07.wav");
  });
});
