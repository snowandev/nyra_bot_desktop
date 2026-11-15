import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { i18n } from "@/shared/i18n/i18n";

export async function ensureNotificationPermission() {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

// The first time closing only hides Nyra: where it went and how to quit for real
export async function notifyKeptInTray(where: string) {
  if (!(await ensureNotificationPermission())) return;
  sendNotification({ title: i18n.t("lib.keptOpenTitle"), body: i18n.t("lib.keptOpenBody", { where }) });
}

// The reply waits for the user (a command to approve, or one asking something) while they are elsewhere. Without
// the command itself, which may be private.
export async function notifyNeedsYou(need: "approval" | "question", count: number) {
  if (await getCurrentWindow().isFocused()) return;
  if (!(await isPermissionGranted())) return;
  sendNotification(
    need === "approval"
      ? { title: i18n.t("lib.approvalTitle", { count }), body: i18n.t("lib.approvalBody") }
      : { title: i18n.t("lib.questionTitle"), body: i18n.t("lib.questionBody") },
  );
}

// Only notify when the user isn't looking at Nyra; the text stays generic so nothing private shows on screen
export async function notifyReplyCompleted() {
  if (await getCurrentWindow().isFocused()) return;
  if (!(await isPermissionGranted())) return;
  sendNotification({ title: i18n.t("lib.replyTitle"), body: i18n.t("lib.replyBody") });
}
