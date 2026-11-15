import { useTranslation } from "react-i18next";
import { imageSrc } from "@/features/attachments/attachments";
import type { Attachment } from "@/shared/types";

type Props = {
  shots: Attachment[];
  onOpen: (shot: Attachment) => void;
};

// The screenshots a reply took in the browser, large enough to read; one opens in the viewer to see or save it
export function ReplyScreenshots({ shots, onOpen }: Props) {
  const { t } = useTranslation();
  return (
    <div className="reply-screenshots">
      {shots.map((shot) => (
        <button
          key={shot.id}
          type="button"
          className="reply-screenshot"
          aria-label={t("attachments.chip.view", { name: shot.name })}
          onClick={() => onOpen(shot)}
        >
          <img src={imageSrc(shot)} alt="" />
          <span>{shot.name}</span>
        </button>
      ))}
    </div>
  );
}
