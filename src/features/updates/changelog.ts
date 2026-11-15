// The release notes: CHANGELOG.md (English) and CHANGELOG.es.md (Spanish) are written by hand, one section per
// version, and become changelog.json on each release (tools/release/changelog.ts), which Nyra reads to show what a
// new version brings. Self-contained, so the release script can run it with Node as it is.

export type NoteGroup = "new" | "improvements" | "fixes";
export type NoteLanguage = "en" | "es";
export type Notes = Record<NoteGroup, string[]>;

export type VersionNotes = { version: string; date: string; notes: Record<NoteLanguage, Notes> };
export type Changelog = { versions: VersionNotes[] };

export const NOTE_GROUPS: NoteGroup[] = ["new", "improvements", "fixes"];

// The headings each file uses for its groups
const GROUP_HEADINGS: Record<NoteLanguage, Record<string, NoteGroup>> = {
  en: { new: "new", improvements: "improvements", fixes: "fixes" },
  es: { novedades: "new", mejoras: "improvements", arreglos: "fixes" },
};

// "## 0.9.1 · 2026-11-20", also with "-" or "—" between them
const VERSION_HEADING = /^##\s+v?(\d+\.\d+\.\d+)\s*[·\-—]\s*(\d{4}-\d{2}-\d{2})\s*$/;
const GROUP_HEADING = /^###\s+(.+?)\s*$/;
const ITEM = /^[-*]\s+(.+?)\s*$/;

const emptyNotes = (): Notes => ({ new: [], improvements: [], fixes: [] });

// One file's versions, newest first as written; a line it doesn't know (the title, an intro) is left out
export function parseChangelog(markdown: string, language: NoteLanguage) {
  const versions: { version: string; date: string; notes: Notes }[] = [];
  let group: NoteGroup | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = VERSION_HEADING.exec(line);
    if (heading) {
      versions.push({ version: heading[1], date: heading[2], notes: emptyNotes() });
      group = null;
      continue;
    }
    const groupHeading = GROUP_HEADING.exec(line);
    if (groupHeading) {
      group = GROUP_HEADINGS[language][groupHeading[1].toLowerCase()] ?? null;
      continue;
    }
    const item = ITEM.exec(line);
    const current = versions.at(-1);
    if (item && group && current) current.notes[group].push(item[1]);
  }
  return versions;
}

// Both files into one changelog. A version missing from one of them, or dated differently, is a mistake to fix
// before publishing, so it fails rather than showing half the notes in one language.
export function mergeChangelogs(english: string, spanish: string): Changelog {
  const en = parseChangelog(english, "en");
  const es = new Map(parseChangelog(spanish, "es").map((v) => [v.version, v]));
  if (en.length !== es.size) throw new Error("CHANGELOG.md and CHANGELOG.es.md don't have the same versions");
  return {
    versions: en.map((version) => {
      const translated = es.get(version.version);
      if (!translated) throw new Error(`${version.version} is missing from CHANGELOG.es.md`);
      if (translated.date !== version.date) throw new Error(`${version.version} has a different date in each file`);
      return { version: version.version, date: version.date, notes: { en: version.notes, es: translated.notes } };
    }),
  };
}

// Negative when a is older than b
export function compareVersions(a: string, b: string) {
  const parts = (v: string) => v.split(".").map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

// What the user gets updating from `current` to `latest`: every version in between, newest first
export const versionsBetween = (changelog: Changelog, current: string, latest: string) =>
  changelog.versions
    .filter((v) => compareVersions(v.version, current) > 0 && compareVersions(v.version, latest) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));

// The changelog.json downloaded with a release, checked: it comes from the network
export function readChangelog(data: unknown): Changelog | null {
  const strings = (value: unknown) => Array.isArray(value) && value.every((s) => typeof s === "string");
  const isNotes = (value: unknown) =>
    typeof value === "object" && value !== null && NOTE_GROUPS.every((g) => strings((value as Notes)[g]));
  const versions = (data as Changelog | null)?.versions;
  if (!Array.isArray(versions)) return null;
  const valid = versions.every(
    (v) =>
      typeof v?.version === "string" &&
      typeof v.date === "string" &&
      isNotes(v.notes?.en) &&
      isNotes(v.notes?.es),
  );
  return valid ? { versions } : null;
}

// The notes of one version as Markdown, in both languages, for the release page on GitHub
export function releaseBody(changelog: Changelog, version: string) {
  const found = changelog.versions.find((v) => v.version === version);
  if (!found) throw new Error(`${version} isn't in the changelog`);
  const titles: Record<NoteLanguage, Record<NoteGroup, string>> = {
    en: { new: "New", improvements: "Improvements", fixes: "Fixes" },
    es: { new: "Novedades", improvements: "Mejoras", fixes: "Arreglos" },
  };
  const language = (lang: NoteLanguage) =>
    NOTE_GROUPS.filter((g) => found.notes[lang][g].length > 0)
      .map((g) => `### ${titles[lang][g]}\n${found.notes[lang][g].map((item) => `- ${item}`).join("\n")}`)
      .join("\n\n");
  return `${language("en")}\n\n---\n\n${language("es")}\n`;
}
