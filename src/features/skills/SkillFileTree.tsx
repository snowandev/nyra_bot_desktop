import { File, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/shared/lib/format";
import type { SkillFile } from "./skills";

type Props = {
  files: SkillFile[];
};

type Row = { key: string; name: string; isFolder: boolean; isNested: boolean; size?: number };

// SKILL.md first, then loose files, then each top-level folder followed by everything inside it
function rowsOf(files: SkillFile[]): Row[] {
  const rootFiles = files.filter((f) => !f.path.includes("/"));
  rootFiles.sort((a, b) => Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md"));
  const folders = new Map<string, SkillFile[]>();
  for (const file of files) {
    const slash = file.path.indexOf("/");
    if (slash === -1) continue;
    const folder = file.path.slice(0, slash);
    folders.set(folder, [...(folders.get(folder) ?? []), file]);
  }
  return [
    ...rootFiles.map((f) => ({ key: f.path, name: f.path, isFolder: false, isNested: false, size: f.size })),
    ...[...folders].flatMap(([folder, inside]) => [
      { key: `${folder}/`, name: `${folder}/`, isFolder: true, isNested: false },
      ...inside.map((f) => ({
        key: f.path,
        name: f.path.slice(folder.length + 1),
        isFolder: false,
        isNested: true,
        size: f.size,
      })),
    ]),
  ];
}

export function SkillFileTree({ files }: Props) {
  const { t } = useTranslation();
  return (
    <div className="skill-section">
      <h4>
        {t("skills.files.title")}
        <span className="skill-section-aside">{t("skills.files.count", { count: files.length })}</span>
      </h4>
      <ul className="skill-files">
        {rowsOf(files).map((row) => (
          <li key={row.key} className={row.isNested ? "nested" : undefined}>
            {row.isFolder ? (
              <Folder size={15} strokeWidth={2} className="skill-file-folder" />
            ) : (
              <File size={15} strokeWidth={2} className="skill-file-icon" />
            )}
            <span className="mono skill-file-name">{row.name}</span>
            {row.name === "SKILL.md" && <span className="skill-pill accent">{t("skills.files.used")}</span>}
            {row.isFolder && <span className="skill-pill">{t("skills.files.kept")}</span>}
            {row.size !== undefined && <span className="skill-file-size">{formatBytes(row.size)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
