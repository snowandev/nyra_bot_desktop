import type { Ref } from "react";
import { citationsOf, citedSources } from "@/features/markdown/citations";
import { useTranslation } from "react-i18next";
import type { Message } from "@/shared/types";
import { ReplyContent } from "@/features/chat/ReplyContent";
import { NyraAvatar } from "./NyraAvatar";
import { WebSearchSummary } from "@/features/web/WebSearchSummary";

type Props = {
  ref: Ref<HTMLDivElement>;
  // The user message the reply answers; without it the reply often makes no sense on its own
  question: Message | undefined;
  answer: Message;
};

// What the shared image shows: the same chat styles, without buttons, stats or anything that only works in the app
export function ShareCard({ ref, question, answer }: Props) {
  const { t } = useTranslation();
  const files = (question?.attachments ?? []).map((a) => a.name);
  const referenced = question?.references?.length ?? 0;
  const searched = answer.webSearch;
  const citations = searched ? citationsOf(answer.content, searched) : null;
  // Links can't be followed in an image, so the cited sources are written out with their address
  const cited = citations ? citedSources(citations) : [];

  return (
    <div className="share-card" ref={ref}>
      {question && (question.content || files.length > 0 || referenced > 0) && (
        <div className="user-message">
          {question.content && <div className="user-bubble">{question.content}</div>}
          {(files.length > 0 || referenced > 0) && (
            <span className="share-card-files">
              {files.length > 0 ? files.join(" · ") : t("share.referenced", { count: referenced })}
            </span>
          )}
        </div>
      )}
      <div className="assistant-message">
        <NyraAvatar />
        <div className="assistant-body">
          <div className="assistant-meta">
            <span className="assistant-name">Nyra</span>
          </div>
          {searched && searched.steps.length > 0 && citations && (
            <WebSearchSummary steps={searched.steps} citations={citations} />
          )}
          <ReplyContent content={answer.content} isForImage citations={citations} />
        </div>
      </div>
      {cited.length > 0 && (
        <div className="share-card-sources">
          <b>{t("share.sources")}</b>
          <ol>
            {cited.map(({ shown, source }) => (
              <li key={shown}>
                <span className="cited-source-number">{shown}</span>
                <span className="share-card-source">
                  <span>{source.title}</span>
                  <span className="share-card-source-url">{source.url.replace(/^https?:\/\//, "")}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
