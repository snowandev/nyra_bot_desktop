// The command that starts a server, as one line the user pastes ("npx -y @scope/server --dir \"/a b\"") and back

export function splitCommandLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) parts.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) parts.push(current);
  return parts;
}

export const joinCommandLine = (parts: string[]) =>
  parts.map((part) => (part === "" || /[\s"']/.test(part) ? `"${part.replace(/"/g, "'")}"` : part)).join(" ");
