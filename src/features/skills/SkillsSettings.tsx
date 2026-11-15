import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkillsContext } from "./skillsContext";
import type { SkillImportResult, SkippedSkill } from "./skills";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { SkillAdaptation } from "./SkillAdaptation";
import { SkillDetail } from "./SkillDetail";
import { SkillForm } from "./SkillForm";
import { SkillImport } from "./SkillImport";
import { SkillImportSummary } from "./SkillImportSummary";
import { SkillList } from "./SkillList";
import { SkillsEmpty } from "./SkillsEmpty";

type View =
  | { kind: "detail" }
  | { kind: "new" }
  | { kind: "edit" }
  | { kind: "import" }
  | { kind: "result"; results: SkillImportResult[]; skipped: SkippedSkill[] }
  // Adapted one after another; `done` counts the ones already handled, for the "2 of 3" label
  | { kind: "adapt"; queue: string[]; done: number };

type Props = {
  // A skill to show first, e.g. from «Ver en Configuración» in a reply
  initialSkill?: string;
};

export function SkillsSettings({ initialSkill }: Props) {
  const { skills, error, reload, renameDefaultSkill } = useSkillsContext();
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: "detail" });
  const [selectedName, setSelectedName] = useState<string | null>(initialSkill ?? null);
  // Falls back to the first one, e.g. after the selected skill was deleted
  const selected = skills.find((s) => s.name === selectedName) ?? skills[0];

  function show(name: string | null) {
    setSelectedName(name);
    setView({ kind: "detail" });
  }

  async function afterChange(name: string | null) {
    await reload();
    show(name);
  }

  const openNew = () => setView({ kind: "new" });
  const openImport = () => setView({ kind: "import" });
  const openAdapt = (names: string[]) => setView({ kind: "adapt", queue: names, done: 0 });

  // Saved or skipped: on to the next one, or back to the last skill once the queue is empty
  async function nextAdaptation(queue: string[], done: number) {
    const [current, ...rest] = queue;
    await reload();
    if (rest.length > 0) setView({ kind: "adapt", queue: rest, done: done + 1 });
    else show(current);
  }

  const adapting = view.kind === "adapt" ? skills.find((s) => s.name === view.queue[0]) : undefined;

  if (skills.length === 0 && view.kind === "detail") {
    return (
      <div className="skills-settings">
        {error && <ErrorNotice title={error} />}
        <div className="skills-layout">
          <SkillsEmpty onNew={openNew} onImport={openImport} />
        </div>
      </div>
    );
  }

  return (
    <div className="skills-settings">
      {error && <ErrorNotice title={error} />}
      <div className="skills-layout">
        <SkillList
          skills={skills}
          selectedName={
            view.kind === "detail" || view.kind === "edit"
              ? (selected?.name ?? null)
              : view.kind === "adapt"
                ? (adapting?.name ?? null)
                : null
          }
          onSelect={show}
          onNew={openNew}
          onImport={openImport}
        />
        {view.kind === "detail" && selected && (
          <SkillDetail
            key={selected.name}
            skill={selected}
            onEdit={() => setView({ kind: "edit" })}
            onAdapt={() => openAdapt([selected.name])}
            onChanged={() => afterChange(selected.name)}
            onDeleted={() => afterChange(null)}
          />
        )}
        {view.kind === "adapt" && adapting && (
          <SkillAdaptation
            key={`${adapting.name}-${view.done}`}
            skill={adapting}
            position={
              view.queue.length + view.done > 1
                ? t("skills.adapt.position", { current: view.done + 1, total: view.queue.length + view.done })
                : undefined
            }
            onSaved={() => nextAdaptation(view.queue, view.done)}
            onSkip={() => nextAdaptation(view.queue, view.done)}
            onCancel={() => show(adapting.name)}
          />
        )}
        {(view.kind === "new" || view.kind === "edit") && (
          <SkillForm
            key={view.kind === "edit" ? selected?.name : "new"}
            skill={view.kind === "edit" ? selected : undefined}
            takenNames={skills.map((s) => s.name)}
            onSaved={(name) => {
              if (view.kind === "edit" && selected && selected.name !== name) renameDefaultSkill(selected.name, name);
              afterChange(name);
            }}
            onCancel={() => setView({ kind: "detail" })}
          />
        )}
        {view.kind === "import" && (
          <SkillImport
            onImported={(results, skipped) => {
              reload();
              setView({ kind: "result", results, skipped });
            }}
            onCancel={() => setView({ kind: "detail" })}
          />
        )}
        {view.kind === "result" && (
          <SkillImportSummary
            results={view.results}
            skipped={view.skipped}
            onChanged={reload}
            onImportMore={openImport}
            onAdapt={openAdapt}
            onDone={show}
          />
        )}
      </div>
    </div>
  );
}
