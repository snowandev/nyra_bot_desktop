import { type ComponentProps, Suspense } from "react";
import { retryingLazy } from "@/shared/lib/loadOnDemand";
import { LoadErrorBoundary } from "@/shared/ui/LoadErrorBoundary";

// The viewer (with pdf.js and the spreadsheet grid) loads the first time a file is opened, not when Nyra starts
const AttachmentViewer = retryingLazy(() => import("./AttachmentViewer").then((m) => m.AttachmentViewer));

export function LazyAttachmentViewer(props: ComponentProps<typeof AttachmentViewer>) {
  return (
    <LoadErrorBoundary>
      <Suspense fallback={null}>
        <AttachmentViewer {...props} />
      </Suspense>
    </LoadErrorBoundary>
  );
}
