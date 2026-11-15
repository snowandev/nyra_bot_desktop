import { DocumentCard } from "@/features/documents/DocumentCard";
import type { Attachment } from "@/shared/types";
import { transcriptFileName } from "./transcript";

type Props = {
  transcript: Attachment;
};

// A transcript in the reply that got it, as a document: its preview folds when long, and it can be copied or saved as
// Markdown or PDF like any report Nyra writes
export function TranscriptCard({ transcript }: Props) {
  const title = transcript.data.match(/^# (.+)$/m)?.[1] ?? transcript.name;
  const audioName = transcript.name.replace(/ \([^)]*\)\.md$/, "");
  return (
    <DocumentCard
      document={{ title, filename: transcriptFileName(audioName), content: transcript.data, isComplete: true }}
      isWriting={false}
    />
  );
}
