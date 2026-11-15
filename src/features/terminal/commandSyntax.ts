// The parts of a command line, told by their shape so it works for bash, zsh and PowerShell alike: the program
// (first word, or after a pipe or a separator), its options, quoted strings, variables, operators and comments

export type CommandTokenKind = "program" | "option" | "string" | "variable" | "operator" | "comment" | "text";

type CommandToken = { kind: CommandTokenKind; text: string; start: number };

const OPERATORS = ["&&", "||", ">>", "2>&1", "2>", "|", ";", ">", "<", "&"];
// After these the next word is a program again
const STARTS_COMMAND = new Set(["&&", "||", "|", ";", "&"]);
const WORD_END = /[\s'"|;&<>]/;

export function commandTokens(command: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let at = 0;
  let expectsProgram = true;
  const push = (kind: CommandTokenKind, text: string, start: number) => tokens.push({ kind, text, start });

  while (at < command.length) {
    const start = at;
    const char = command[at];
    if (/\s/.test(char)) {
      while (at < command.length && /\s/.test(command[at])) at++;
      push("text", command.slice(start, at), start);
      continue;
    }
    if (char === "#" && (start === 0 || /\s/.test(command[start - 1]))) {
      push("comment", command.slice(start), start);
      break;
    }
    if (char === "'" || char === '"') {
      at++;
      while (at < command.length && command[at] !== char) at += char === '"' && command[at] === "\\" ? 2 : 1;
      at = Math.min(at + 1, command.length);
      push("string", command.slice(start, at), start);
      expectsProgram = false;
      continue;
    }
    const operator = OPERATORS.find((op) => command.startsWith(op, at));
    if (operator) {
      at += operator.length;
      push("operator", operator, start);
      if (STARTS_COMMAND.has(operator)) expectsProgram = true;
      continue;
    }
    if (char === "$") {
      const variable = command.slice(at).match(/^\$(\{[^}]*\}|env:\w+|\w+|[?$!@#*0-9])/i);
      if (variable) {
        at += variable[0].length;
        push("variable", variable[0], start);
        continue;
      }
    }
    while (at < command.length && !WORD_END.test(command[at])) at++;
    if (at === start) at++;
    const word = command.slice(start, at);
    // VAR=value before the program sets its environment; the program comes after
    if (expectsProgram && /^\w+=/.test(word)) {
      push("text", word, start);
    } else if (expectsProgram) {
      push("program", word, start);
      expectsProgram = false;
    } else {
      push(/^--?[A-Za-z]/.test(word) ? "option" : "text", word, start);
    }
  }
  return tokens;
}
