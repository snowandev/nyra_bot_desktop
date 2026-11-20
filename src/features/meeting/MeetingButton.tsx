import { CircleDot, LoaderCircle, Square } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useElapsedSeconds } from "@/shared/hooks/useElapsedSeconds";
import type { Attachment } from "@/shared/types";
import { clock } from "@/features/transcription/transcript";
import { record, stopRecording, takeEndedRecording, useMeeting } from "./meetingRecorder";

type Props = {
  // Each box draws its buttons its own way
  className: string;
  // The recording, once stopped, as an audio for the message
  onRecorded: (audio: Attachment) => void;
};

// Next to the microphone: records a meeting, and while it does, shows for how long and stops it
export function MeetingButton({ className, onRecorded }: Props) {
  const { t } = useTranslation();
  const meeting = useMeeting();
  const isRecording = meeting.phase === "recording";
  const isBusy = meeting.phase === "starting" || meeting.phase === "stopping";
  const seconds = useElapsedSeconds(isRecording, isRecording ? meeting.startedAt : undefined);

  // One that reached its limit while this box was on screen, or before it came back
  useEffect(() => {
    const audio = takeEndedRecording();
    if (audio) onRecorded(audio);
  }, [meeting, onRecorded]);

  async function stop() {
    const audio = await stopRecording();
    if (audio) onRecorded(audio);
  }

  const label = isRecording ? t("meeting.stop") : t("meeting.start");
  return (
    <button
      type="button"
      className={`${className} meeting-button ${isRecording ? "recording" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={isRecording}
      disabled={isBusy}
      onClick={() => void (isRecording ? stop() : record())}
    >
      {isBusy ? (
        <LoaderCircle size={16} strokeWidth={2} className="spin" aria-hidden="true" />
      ) : isRecording ? (
        <>
          <Square size={12} fill="currentColor" aria-hidden="true" />
          <span className="meeting-time">{clock(seconds)}</span>
        </>
      ) : (
        <CircleDot size={16} strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}
