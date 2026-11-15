import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { answerCommand } from "./commandControl";

type Props = {
  id: string;
  // The terminal hides what is typed: a password, typed hidden and never kept
  isSecret: boolean;
};

// The answer to what the command asked, with shortcuts for yes and no; it goes to the command, not to Nyra
export function CommandAnswer({ id, isSecret }: Props) {
  const { t } = useTranslation();
  const inputId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(answer: string) {
    setError(null);
    try {
      await answerCommand(id, answer);
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <div className="command-answer">
        <span className="command-prompt" aria-hidden="true">
          ›
        </span>
        <label className="visually-hidden" htmlFor={inputId}>
          {isSecret ? t("terminal.answer.passwordLabel") : t("terminal.answer.answerLabel")}
        </label>
        <input
          id={inputId}
          type={isSecret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          placeholder={isSecret ? t("terminal.answer.password") : t("terminal.answer.placeholder")}
          value={text}
          data-command-focus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void send(text);
          }}
        />
        {!isSecret && (
          <>
            <button type="button" className="outline-button small" onClick={() => void send("s")}>
              s
            </button>
            <button type="button" className="outline-button small" onClick={() => void send("n")}>
              n
            </button>
          </>
        )}
        <button type="button" className="primary-button small" onClick={() => void send(text)}>
          {t("terminal.answer.send")}
        </button>
      </div>
      <div className="command-answer-note" role={error ? "alert" : undefined}>
        {error ??
          (isSecret ? t("terminal.answer.noteSecret") : t("terminal.answer.note"))}
      </div>
    </>
  );
}
