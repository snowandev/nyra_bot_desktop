import { Check, FolderSearch, Info } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

type Props = {
  // The embedding model that searches by meaning now
  inUse: string;
  // Marked by the user, rather than picked by Nyra
  isChosen: boolean;
  isOnlyOne: boolean;
  onLetNyraChoose: () => void;
};

// Over the search group: which model searches and why, so the automatic choice is never a guess
export function EmbeddingStatus({ inUse, isChosen, isOnlyOne, onLetNyraChoose }: Props) {
  const { t } = useTranslation();
  const name = { name: <b className="mono" /> };
  return (
    <p className="embedding-status" role="status">
      {isChosen ? <Check size={15} strokeWidth={2.4} /> : <Info size={15} strokeWidth={2.2} />}
      <span>
        {isChosen ? (
          <>
            <Trans i18nKey="models.embedding.chosen" values={{ name: inUse }} components={name} />{" "}
            <button type="button" className="embedding-status-link" onClick={onLetNyraChoose}>
              {t("models.embedding.letNyraChoose")}
            </button>
          </>
        ) : isOnlyOne ? (
          <Trans i18nKey="models.embedding.onlyOne" values={{ name: inUse }} components={name} />
        ) : (
          <Trans
            i18nKey="models.embedding.auto"
            values={{ name: inUse }}
            components={{
              ...name,
              icon: (
                <FolderSearch
                  size={14}
                  strokeWidth={2.2}
                  role="img"
                  aria-label={t("models.embedding.iconLabel")}
                />
              ),
            }}
          />
        )}
      </span>
    </p>
  );
}
