import { getProvider } from "@/providers";
import { i18n } from "@/shared/i18n/i18n";
import type { Attachment, Model } from "@/shared/types";

// Runs on this computer while the user writes; nothing is sent anywhere to check a message

export type SensitiveKind = "key" | "password" | "private-key" | "card";

// What each detector found, named in the catalog under sensitive.labels
type SensitiveLabel =
  | "anthropicKey"
  | "openaiKey"
  | "googleKey"
  | "awsKey"
  | "githubToken"
  | "gitlabToken"
  | "slackToken"
  | "stripeKey"
  | "privateKey"
  | "password"
  | "card";

type Detector = { kind: SensitiveKind; label: SensitiveLabel; pattern: RegExp; accept?: (match: string) => boolean };

export type SensitiveMatch = {
  kind: SensitiveKind;
  // In the interface's language, as it was when the text was checked
  label: string;
  value: string;
  // In the message: the line it is on; in a file: which one
  place: { type: "message"; line: number } | { type: "file"; id: string; name: string };
};

// Values that only stand in for a secret, as in documentation and examples
const PLACEHOLDER = /^[<{$[]|x{4,}|\*{3,}|\.{3}|your|tu[_-]|example|ejemplo|changeme|placeholder|dummy|redacted/i;

function passesLuhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

// Card networks start with 3 to 6; this also leaves out millisecond timestamps, which start with 1
function isCardNumber(match: string) {
  const digits = match.replace(/[ -]/g, "");
  return digits.length >= 13 && digits.length <= 19 && /^[3-6]/.test(digits) && passesLuhn(digits);
}

const valueOf = (match: string) => match.split(/[:=]\s*["']?/).pop()?.replace(/["']$/, "") ?? "";
const secretValue = (match: string) => !PLACEHOLDER.test(valueOf(match));

// Order matters: an Anthropic key also looks like an OpenAI one, so the more specific one goes first
const DETECTORS: Detector[] = [
  { kind: "key", label: "anthropicKey", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "key", label: "openaiKey", pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "key", label: "googleKey", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "key", label: "awsKey", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "key", label: "githubToken", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { kind: "key", label: "gitlabToken", pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: "key", label: "slackToken", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "key", label: "stripeKey", pattern: /\b[sr]k_live_[A-Za-z0-9]{20,}/g },
  { kind: "private-key", label: "privateKey", pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
  {
    // .env style: PASSWORD=…, DB_SECRET=…, API_KEY=…
    kind: "password",
    label: "password",
    pattern: /^[ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY)[A-Z0-9_]*[ \t]*=[ \t]*["']?[^\s"']{6,}/gm,
    accept: secretValue,
  },
  {
    // Java .properties and YAML: mail.password=…, client_secret: …. The last part of the name has to be the secret
    // (token.validitySeconds isn't one), and the value runs to the end of the line, so code (token = getToken()) isn't
    kind: "password",
    label: "password",
    pattern:
      /^[ \t]*(?:[A-Za-z0-9_-]+\.)*[A-Za-z0-9_-]*(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|credentials?)[ \t]*[:=][ \t]*[^\s"'#;(){},]{4,}(?=[ \t]*(?:#.*)?$)/gim,
    accept: secretValue,
  },
  {
    // A quoted value, as in JSON, YAML or code: "password": "…", contraseña: '…'
    kind: "password",
    label: "password",
    pattern: /\b(?:password|passwd|contraseña|secret|api[_-]?key|access[_-]?token)["']?[ \t]*[:=][ \t]*["'][^"'\s]{8,}["']/gi,
    accept: secretValue,
  },
  { kind: "card", label: "card", pattern: /\b\d(?:[ -]?\d){12,18}\b/g, accept: isCardNumber },
];

// A stretch of text counts once, for the most specific detector: ANTHROPIC_API_KEY=sk-ant-… is an Anthropic key,
// not also a generic secret
function matchesIn(text: string) {
  const found: { kind: SensitiveKind; label: SensitiveLabel; value: string; index: number }[] = [];
  for (const { pattern, accept, ...detector } of DETECTORS) {
    for (const m of text.matchAll(pattern)) {
      const end = m.index + m[0].length;
      const overlaps = found.some((f) => m.index < f.index + f.value.length && f.index < end);
      if (overlaps || (accept && !accept(m[0]))) continue;
      found.push({ ...detector, value: m[0], index: m.index });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

const labelOf = (label: SensitiveLabel) => i18n.t(`sensitive.labels.${label}`);

// Everything that looks like a secret in a message and the text of its files (images are not read). A value
// repeated in the same place counts once.
export function findSensitiveData(text: string, files: Attachment[] = []): SensitiveMatch[] {
  const inMessage = matchesIn(text).map(({ index, label, ...m }) => ({
    ...m,
    label: labelOf(label),
    place: { type: "message" as const, line: text.slice(0, index).split("\n").length },
  }));
  const inFiles = files
    .filter((f) => f.kind !== "image")
    .flatMap((f) =>
      matchesIn(f.data).map(({ index: _index, label, ...m }) => ({
        ...m,
        label: labelOf(label),
        place: { type: "file" as const, id: f.id, name: f.name },
      })),
    );
  const seen = new Set<string>();
  return [...inMessage, ...inFiles].filter((m) => {
    const key = [m.label, m.value, m.place.type === "file" ? m.place.id : "message"].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g;

// What goes in place of a secret: says what was there, never the value. In English for what only the model reads (a
// folder's files); in the interface's language for what the user hides in their own message, which they also see.
type HiddenWords = { value: string; card: string; key: string };
const FOR_MODEL: HiddenWords = { value: "[hidden]", card: "[hidden card number]", key: "[hidden key]" };
const forUser = (): HiddenWords => ({
  value: i18n.t("sensitive.hidden.value"),
  card: i18n.t("sensitive.hidden.card"),
  key: i18n.t("sensitive.hidden.key"),
});

function hiddenValue(kind: SensitiveKind, value: string, words: HiddenWords) {
  if (kind === "password") {
    const name = value.match(/^[\s\S]*?[:=][ \t]*["']?/)?.[0] ?? "";
    return `${name}${words.value}${/["']$/.test(value) ? value.slice(-1) : ""}`;
  }
  if (kind === "card") return words.card;
  return words.key;
}

// The text of a file with its secrets hidden, for what the model reads of a folder: the name of each setting stays,
// its value doesn't. Every line stays where it was, so line numbers still point to the right place.
export function withSecretsHidden(text: string, words = FOR_MODEL): { text: string; hidden: number } {
  let hidden = 0;
  // A private key is many lines; the detector only sees its first one
  let out = text.replace(PRIVATE_KEY_BLOCK, (block) => {
    hidden++;
    const lines = block.split("\n");
    return lines.map((line, i) => (i === 0 || i === lines.length - 1 ? line : words.value)).join("\n");
  });
  const found = matchesIn(out).filter((m) => m.kind !== "private-key");
  for (const m of [...found].reverse()) {
    out = out.slice(0, m.index) + hiddenValue(m.kind, m.value, words) + out.slice(m.index + m.value.length);
    hidden++;
  }
  return { text: out, hidden };
}

// "Ocultar antes de enviar": the message and the files attached to it with every secret's value hidden, before it
// leaves for a cloud provider. A file keeps only what was checked: a spreadsheet loses the original file kept to make
// versions, and a PDF the pictures of its pages, either of which could still show the value. Files sent with earlier
// messages are already gone and aren't touched.
export function hideSecrets(text: string, files: Attachment[]) {
  const words = forUser();
  const message = withSecretsHidden(text, words);
  let hidden = message.hidden;
  const changed = files.flatMap((file) => {
    if (file.kind === "image") return [];
    const result = withSecretsHidden(file.data, words);
    if (result.hidden === 0) return [];
    hidden += result.hidden;
    const { workbook: _workbook, visuals: _visuals, pages: _pages, ...rest } = file;
    return [{ ...rest, data: result.text }];
  });
  return { text: message.text, files: changed, hidden };
}

// Enough to recognize it without showing it again
export function maskSecret({ kind, value }: SensitiveMatch) {
  if (kind === "card") return `•••• ${value.replace(/\D/g, "").slice(-4)}`;
  if (kind === "private-key") return "-----BEGIN … PRIVATE KEY-----";
  // The name stays (DB_PASSWORD=, password:), only the value is hidden
  if (kind === "password") return `${(value.match(/^[^:=]*[:=]\s*/)?.[0] ?? "").replace(/["']/g, "")}••••••••`;
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-4)}` : `${value.slice(0, 3)}…`;
}

export const labelsOf = (matches: SensitiveMatch[]) => [...new Set(matches.map((m) => m.label))];

// For each message, the cloud provider of the first later reply that came from one: every reply resends the whole
// history, so that is where the message ended up. It takes, per message, the name of the model that wrote it (empty
// for the user's messages): replies store the model's name, and a model no longer listed is unknown.
export function cloudDestinations(writtenBy: string[], models: Model[]): (string | undefined)[] {
  const result: (string | undefined)[] = [];
  let next: string | undefined;
  for (let i = writtenBy.length - 1; i >= 0; i--) {
    result[i] = next;
    const provider = writtenBy[i] ? getProvider(models.find((m) => m.name === writtenBy[i])?.providerId ?? "") : null;
    if (provider?.requiresApiKey) next = provider.name;
  }
  return result;
}
