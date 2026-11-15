import { useEffect, useRef, useState } from "react";
import { readAttachment } from "./attachments";
import { i18n } from "@/shared/i18n/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { isPdf, type PdfProgress } from "./pdf";
import { pageAttachment } from "@/features/web/webLinks";
import { fetchPage } from "@/features/web/webSearchStorage";
import { domainOf } from "@/shared/lib/links";
import type { Attachment } from "@/shared/types";
import { isAudio } from "@/features/transcription/transcript";
import { storeAudioFile } from "@/features/transcription/audioFiles";

type PendingPdf = {
  id: string;
  name: string;
  progress: PdfProgress | null;
  controller: AbortController;
};

type PendingPage = { id: string; url: string };

// An audio being kept as a file; it can't be stopped halfway, so a cancelled one is dropped when it is ready
type PendingAudio = { id: string; name: string };

// help says what can be attached; a page that couldn't be read has nothing to add
type ComposerError = { message: string; help?: string };

export function useComposerAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingPdfs, setPendingPdfs] = useState<PendingPdf[]>([]);
  const [pendingPages, setPendingPages] = useState<PendingPage[]>([]);
  const [pendingAudios, setPendingAudios] = useState<PendingAudio[]>([]);
  const [fileError, setFileError] = useState<ComposerError | null>(null);
  const controllersRef = useRef(new Set<AbortController>());
  // Reading a page happens in Rust and can't be stopped; a cancelled one is just dropped when it arrives
  const cancelledPages = useRef(new Set<string>());
  const cancelledAudios = useRef(new Set<string>());

  // PDFs still rendering when the composer goes away (e.g. switching chats) would keep working for nothing
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => controllers.forEach((c) => c.abort());
  }, []);

  function updatePending(id: string, progress: PdfProgress) {
    setPendingPdfs((list) => list.map((p) => (p.id === id ? { ...p, progress } : p)));
  }

  async function storeAudio(file: File) {
    const pending: PendingAudio = { id: crypto.randomUUID(), name: file.name };
    setPendingAudios((list) => [...list, pending]);
    try {
      const audio = await storeAudioFile(file);
      if (cancelledAudios.current.has(pending.id)) throw new DOMException("Cancelled", "AbortError");
      return audio;
    } finally {
      cancelledAudios.current.delete(pending.id);
      setPendingAudios((list) => list.filter((p) => p.id !== pending.id));
    }
  }

  async function readFile(file: File) {
    if (isAudio(file)) return storeAudio(file);
    if (!isPdf(file)) return readAttachment(file);
    const pending: PendingPdf = { id: crypto.randomUUID(), name: file.name, progress: null, controller: new AbortController() };
    controllersRef.current.add(pending.controller);
    setPendingPdfs((list) => [...list, pending]);
    try {
      return await readAttachment(file, {
        signal: pending.controller.signal,
        onProgress: (progress) => updatePending(pending.id, progress),
      });
    } finally {
      controllersRef.current.delete(pending.controller);
      setPendingPdfs((list) => list.filter((p) => p.id !== pending.id));
    }
  }

  // Each file appears as soon as it is read, so a long PDF doesn't hold back the rest
  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setFileError(null);
    const errors: string[] = [];
    await Promise.all(
      files.map(async (file) => {
        try {
          const attachment = await readFile(file);
          setAttachments((list) => [...list, attachment]);
        } catch (e) {
          if (!(e instanceof DOMException && e.name === "AbortError")) errors.push(errorMessage(e));
        }
      }),
    );
    if (errors.length > 0) setFileError({ message: errors.join(" "), help: i18n.t("attachments.help") });
  }

  // Pasted links become their pages, as text files; one already attached or on its way isn't read again
  async function addLinks(urls: string[]) {
    const known = new Set([...attachments.map((a) => a.url), ...pendingPages.map((p) => p.url)]);
    const fresh = urls.filter((url) => !known.has(url));
    if (fresh.length === 0) return;
    setFileError(null);
    const errors: string[] = [];
    await Promise.all(
      fresh.map(async (url) => {
        const pending: PendingPage = { id: crypto.randomUUID(), url };
        setPendingPages((list) => [...list, pending]);
        try {
          const page = await fetchPage(url);
          if (!cancelledPages.current.has(pending.id)) setAttachments((list) => [...list, pageAttachment(page)]);
        } catch (e) {
          if (!cancelledPages.current.has(pending.id)) {
            errors.push(i18n.t("attachments.errors.pageUnreadable", { domain: domainOf(url), error: errorMessage(e) }));
          }
        } finally {
          cancelledPages.current.delete(pending.id);
          setPendingPages((list) => list.filter((p) => p.id !== pending.id));
        }
      }),
    );
    if (errors.length > 0) setFileError({ message: errors.join(" ") });
  }

  function cancelPage(id: string) {
    cancelledPages.current.add(id);
    setPendingPages((list) => list.filter((p) => p.id !== id));
  }

  function removeAttachment(id: string) {
    setAttachments((list) => list.filter((a) => a.id !== id));
  }

  // The chip goes away at once; the reading itself stops after the page in progress
  function cancelPdf(id: string) {
    pendingPdfs.find((p) => p.id === id)?.controller.abort();
    setPendingPdfs((list) => list.filter((p) => p.id !== id));
  }

  function cancelAudio(id: string) {
    cancelledAudios.current.add(id);
    setPendingAudios((list) => list.filter((p) => p.id !== id));
  }

  function clearAttachments() {
    setAttachments([]);
    setFileError(null);
  }

  return {
    attachments,
    pendingPdfs,
    pendingPages,
    pendingAudios,
    fileError,
    addFiles,
    addLinks,
    cancelPage,
    removeAttachment,
    // The same files with new content (their secrets hidden), by id
    replaceAttachments: (changed: Attachment[]) =>
      setAttachments((current) => current.map((a) => changed.find((c) => c.id === a.id) ?? a)),
    cancelPdf,
    cancelAudio,
    clearAttachments,
    dismissFileError: () => setFileError(null),
    // A file that came from elsewhere (a screen capture) and couldn't be had
    reportFileError: (message: string) => setFileError({ message }),
  };
}
