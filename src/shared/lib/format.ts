import { currentLocale, i18n } from "@/shared/i18n/i18n";

// Numbers and dates follow the conventions of the interface's language
export const formatNumber = (value: number) => value.toLocaleString(currentLocale());

export function formatDuration(ms: number) {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toLocaleString(currentLocale(), { maximumFractionDigits: 1 })} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(currentLocale(), { day: "numeric", month: "short", year: "numeric" });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const decimal = (value: number) =>
    value.toLocaleString(currentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (bytes < 1024 * 1024) return `${decimal(bytes / 1024)} KB`;
  return `${decimal(bytes / (1024 * 1024))} MB`;
}

// "Mis Notas Útiles" → "mis-notas-utiles": safe as a file or folder name on every system
export function slugify(text: string, maxLength: number) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

// For a file's name: like slugify, but keeping the letters of any script, so "东京会议" stays a name ("informe-ano"
// still drops its accents, as before)
export function fileSlug(text: string, maxLength: number) {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return Array.from(slug).slice(0, maxLength).join("").replace(/-+$/, "");
}

// Its first max characters, with "…" when there was more
export const shortened = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

// Bytes the text takes in UTF-8, as it is saved to a file
export const textBytes = (text: string) => new Blob([text]).size;

const oneDecimal = (value: number) => value.toLocaleString(currentLocale(), { maximumFractionDigits: 1 });

// Model sizes in decimal units, as Ollama and its website write them: 5.2e9 bytes are "5,2 GB"
export function formatStorage(bytes: number) {
  if (bytes >= 1e9) return `${oneDecimal(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export const formatSpeed = (bytesPerSecond: number) => `${formatStorage(bytesPerSecond)}/s`;

// "40 s left", "3 min left"
export function formatRemaining(seconds: number) {
  if (seconds < 60) return i18n.t("format.remainingSeconds", { value: Math.max(1, Math.round(seconds)) });
  if (seconds < 3600) return i18n.t("format.remainingMinutes", { value: Math.round(seconds / 60) });
  return i18n.t("format.remainingHours", { value: oneDecimal(seconds / 3600) });
}

// A share as a percentage; something small but not nothing reads "<1 %" rather than a misleading "0 %"
// 32 768 tokens read as 32K, as models are usually named; 200 000 as 200K and 1 048 576 as 1M
export function contextSize(tokens: number) {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${tokens % 1024 === 0 ? tokens / 1024 : Math.round(tokens / 1000)}K`;
}

export function formatShare(fraction: number) {
  const percent = Math.round(fraction * 100);
  return percent === 0 && fraction > 0 ? "<1 %" : `${percent} %`;
}
