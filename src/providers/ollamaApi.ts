import { readLines } from "./readLines";
import { fetch } from "@tauri-apps/plugin-http";
import { i18n } from "@/shared/i18n/i18n";
import { withoutOrigin } from "./http";

// What every call to Ollama's HTTP API shares, for chatting and for managing models

// Ollama is closed or unreachable; a class rather than a text, so it is recognized in any language
export class OllamaConnectionError extends Error {
  constructor(options?: ErrorOptions) {
    super(i18n.t("providers.ollama.connection"), options);
  }
}

// Ollama explains its errors as { "error": "…" }; that text is kept for the caller to interpret
export class OllamaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function errorText(body: string) {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed && "error" in parsed && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Not JSON: the raw text is the best explanation there is
  }
  return body;
}

export async function request(url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, withoutOrigin(init));
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new OllamaConnectionError({ cause: e });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const message = body
      ? i18n.t("providers.ollama.statusDetail", { status: res.status, detail: errorText(body) })
      : i18n.t("providers.ollama.status", { status: res.status });
    throw new OllamaError(message, res.status);
  }
  return res;
}

function parseLine<T>(line: string): T {
  try {
    return JSON.parse(line) as T;
  } catch {
    throw new Error(i18n.t("providers.unreadable", { name: "Ollama" }));
  }
}

// Ollama streams one JSON object per line
export async function readJsonLines<T>(res: Response, onLine: (value: T) => void) {
  if (!res.body) throw new OllamaConnectionError();
  await readLines(res.body, (line) => {
    if (line.trim()) onLine(parseLine<T>(line));
  });
}
