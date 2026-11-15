import { ArrowUp, Plus, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/shared/lib/format";
import { NOTE_GROUPS, type NoteGroup, type VersionNotes } from "./changelog";

const GROUP_ICONS: Record<NoteGroup, typeof Plus> = { new: Plus, improvements: ArrowUp, fixes: Wrench };

// "2026-11-20" in the interface's own way of writing dates
export const versionDate = (day: string) => formatDate(new Date(`${day}T00:00:00`).getTime());

type Props = {
  versions: VersionNotes[];
  // With several versions each says its number and date; a single one already has them in the window's header
  showHeadings: boolean;
};

// Each version's notes in the interface's language, by group, leaving out a group with nothing
export function UpdateNotes({ versions, showHeadings }: Props) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage === "es" ? "es" : "en";
  return versions.map((v) => (
    <section key={v.version} className="update-version" aria-label={t("updates.notes.version", { version: v.version })}>
      {showHeadings && (
        <h3>
          {t("updates.notes.version", { version: v.version })} <small>· {versionDate(v.date)}</small>
        </h3>
      )}
      {NOTE_GROUPS.filter((group) => v.notes[language][group].length > 0).map((group) => {
        const Icon = GROUP_ICONS[group];
        return (
          <div key={group} className="update-group">
            <h4>
              <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
              {t(`updates.notes.groups.${group}`)}
            </h4>
            <ul>
              {v.notes[language][group].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  ));
}
