import { CircleAlert, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RemoveButton } from "@/shared/ui/RemoveButton";
import { discardRecording, dismissMeetingError, useMeeting } from "./meetingRecorder";

// Under the box: what is being recorded, and what went wrong
export function MeetingNotice() {
  const { t } = useTranslation();
  const meeting = useMeeting();

  if (meeting.phase === "recording") {
    return (
      <div className={`meeting-notice ${meeting.systemError ? "warning" : ""}`} role="status">
        <CircleDot size={14} strokeWidth={2} aria-hidden="true" />
        <span className="meeting-notice-text">
          {meeting.systemError
            ? t("meeting.onlyMicrophone", { error: meeting.systemError })
            : t("meeting.recording")}
        </span>
        <button type="button" className="ghost-button small" onClick={() => void discardRecording()}>
          {t("meeting.discard")}
        </button>
      </div>
    );
  }
  if (meeting.phase !== "idle" || !meeting.error) return null;
  return (
    <div className="meeting-notice error" role="alert">
      <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
      <span className="meeting-notice-text">{meeting.error}</span>
      <RemoveButton label={t("meeting.dismiss")} onClick={dismissMeetingError} />
    </div>
  );
}
