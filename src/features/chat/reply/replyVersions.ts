import type { Message, ReplyVersion } from "@/shared/types";

// What belongs to one version of a reply. A record of the type's every field, so one added to ReplyVersion and
// forgotten here doesn't compile: a field left out would show one version's cards over another's, or be lost.
const VERSION_FIELDS: Record<keyof ReplyVersion, true> = {
  content: true,
  model: true,
  modelId: true,
  attachments: true,
  usage: true,
  stats: true,
  webSearch: true,
  reasoning: true,
  skillsUsed: true,
  memoriesSaved: true,
  workspaceConsult: true,
  workspaceChanges: true,
  sheetVersions: true,
  commands: true,
  commitProposal: true,
  browser: true,
  screen: true,
  toolCalls: true,
  transcripts: true,
};
const VERSION_KEYS = Object.keys(VERSION_FIELDS) as (keyof ReplyVersion)[];

function versionOf(message: Message): ReplyVersion {
  const version: Partial<Record<keyof ReplyVersion, unknown>> = {};
  for (const key of VERSION_KEYS) version[key] = message[key];
  return version as ReplyVersion;
}

// Every version of a reply in order, the shown one included
export function versionsOf(message: Message): ReplyVersion[] {
  const others = message.otherVersions ?? [];
  const at = Math.min(message.versionIndex ?? others.length, others.length);
  return [...others.slice(0, at), versionOf(message), ...others.slice(at)];
}

function showing(message: Message, versions: ReplyVersion[], index: number): Message {
  const rest: Message = { ...message };
  for (const key of VERSION_KEYS) delete rest[key];
  delete rest.otherVersions;
  delete rest.versionIndex;
  const others = versions.filter((_, i) => i !== index);
  return { ...rest, ...versions[index], ...(others.length > 0 && { otherVersions: others, versionIndex: index }) };
}

export function selectVersion(message: Message, index: number): Message {
  const versions = versionsOf(message);
  return index >= 0 && index < versions.length ? showing(message, versions, index) : message;
}

// The empty reply a regeneration starts from, keeping what was there as earlier versions
export function nextVersion(previous: Message, placeholder: Message): Message {
  const versions = [...versionsOf(previous), versionOf(placeholder)];
  return showing(placeholder, versions, versions.length - 1);
}

// A regeneration that produced nothing goes back to the latest version; null when there is none
export function withoutEmptyVersion(message: Message): Message | null {
  if (message.content) return message;
  const versions = versionsOf(message).filter((version) => version.content);
  return versions.length > 0 ? showing(message, versions, versions.length - 1) : null;
}
