import type { ComponentProps } from "react";
import { useDraft } from "@/shared/hooks/useDraft";
import { Composer } from "./Composer";

type Props = Omit<ComponentProps<typeof Composer>, "value" | "onChange"> & {
  // Whose unsent text it edits
  place: string;
};

// The composer with its place's draft: only it is drawn again on every key, not the conversation around it
export function DraftComposer({ place, ...props }: Props) {
  const [draft, setDraft] = useDraft(place);
  return <Composer {...props} value={draft} onChange={setDraft} />;
}
