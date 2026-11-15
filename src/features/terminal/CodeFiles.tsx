import { useTranslation } from "react-i18next";
import { CodeFileRow } from "./CodeFileRow";

type Props = {
  conversationId: string;
  files: { path: string; size: number }[];
};

// What a program created, to see and save: it lives in the conversation's folder, which Nyra empties in time
export function CodeFiles({ conversationId, files }: Props) {
  const { t } = useTranslation();
  return (
    <div className="code-files">
      <span className="code-files-title">{t("terminal.code.files", { count: files.length })}</span>
      <ul>
        {files.map((file) => (
          <CodeFileRow key={file.path} conversationId={conversationId} file={file} />
        ))}
      </ul>
    </div>
  );
}
