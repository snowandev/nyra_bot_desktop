import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { readChangelog } from "./changelog";

const RELEASES = "https://github.com/snowandev/nyra_bot_desktop/releases";
// Published with each release beside the installers (tools/release/changelog.ts)
const CHANGELOG_URL = `${RELEASES}/latest/download/changelog.json`;
const CHECK_TIMEOUT_MS = 15_000;

// "selfUpdating": the updater installs it; "package": a Linux .deb or .rpm, which the package manager owns
export type InstallKind = "selfUpdating" | "package";

export const installKind = () => invoke<InstallKind>("install_kind");

// The newer version published, signed with the project's key, or null when this one is the latest
export const findUpdate = () => check({ timeout: CHECK_TIMEOUT_MS });

export const restartNyra = () => relaunch();

// The release page, to download it by hand
export const releasePage = (version: string) => `${RELEASES}/tag/v${version}`;

// Every version's notes; null when the release has none to read
export async function fetchChangelog() {
  const response = await fetch(CHANGELOG_URL, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
  return response.ok ? readChangelog(await response.json()) : null;
}
