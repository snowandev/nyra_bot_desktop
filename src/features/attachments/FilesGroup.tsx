import type { ReactNode } from "react";

type Props = {
  title: string;
  count: number;
  note?: string;
  children: ReactNode;
};

export function FilesGroup({ title, count, note, children }: Props) {
  if (count === 0) return null;
  return (
    <section className="files-group" aria-label={title}>
      <div className="files-group-header">
        <span className="diamond" />
        {title}
        <span className="files-group-count">{count}</span>
      </div>
      {note && <p className="files-group-note">{note}</p>}
      <ul className="files-group-list">{children}</ul>
    </section>
  );
}
