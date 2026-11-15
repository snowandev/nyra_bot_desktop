// A formula inside a sentence, as runs of text for the PDF: pdfmake can't put a picture inside a line, so the formula
// is written with the math fonts, variables in italics, raised and lowered parts as such, a fraction as a/b.

type FormulaRun = {
  text: string;
  italics?: boolean;
  bold?: boolean;
  sup?: boolean;
  sub?: boolean;
  // Words inside the formula (\text{…}), in the document's font
  isText?: boolean;
};

type Style = Omit<FormulaRun, "text">;

// Lowercase Greek letters are variables, in italics; capitals are upright
const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ",
  Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  pm: "±", mp: "∓", times: "×", cdot: "⋅", div: "÷", ast: "∗", circ: "∘", bullet: "∙",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", sim: "∼", equiv: "≡", propto: "∝",
  infty: "∞", partial: "∂", nabla: "∇", int: "∫", oint: "∮", sum: "Σ", prod: "Π", surd: "√",
  to: "→", rightarrow: "→", leftarrow: "←", gets: "←", Rightarrow: "⇒", Leftarrow: "⇐", iff: "⇔",
  leftrightarrow: "↔", mapsto: "↦",
  in: "∈", ni: "∋", subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩",
  emptyset: "∅", forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨",
  ldots: "…", dots: "…", cdots: "⋯", prime: "′", degree: "°", angle: "∠", perp: "⊥", parallel: "∥",
  "{": "{", "}": "}", "%": "%", "$": "$", "&": "&", "#": "#", _: "_", "|": "‖",
};

const SPACES: Record<string, string> = { ",": " ", ":": " ", ";": " ", " ": " ", quad: "  ", qquad: "    ", "!": "" };

// Upright words with their own command (\sin, \log…): the command's name is the word
const NAMED = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg",
  "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "deg", "dim", "ker", "arg", "mod", "Pr",
]);

const IGNORED = new Set(["left", "right", "big", "Big", "bigg", "Bigg", "displaystyle", "textstyle", "limits"]);
const TEXT_COMMANDS = new Set(["text", "mathrm", "textrm", "operatorname", "textnormal", "mbox"]);
const FRACTIONS = new Set(["frac", "dfrac", "tfrac", "cfrac"]);

const OPERATORS: Record<string, string> = { "-": "−", "*": "∗", "'": "′" };

class Reader {
  private at = 0;
  constructor(private readonly latex: string) {}

  get done() {
    return this.at >= this.latex.length;
  }

  peek() {
    return this.latex[this.at];
  }

  next() {
    return this.latex[this.at++];
  }

  back() {
    this.at--;
  }

  command() {
    const rest = this.latex.slice(this.at);
    const name = /^[a-zA-Z]+/.exec(rest)?.[0] ?? rest[0] ?? "";
    this.at += name.length;
    return name;
  }

  // What a command or ^ applies to: a {group} or a single character (\cmd counts as one)
  argument(): string {
    while (this.peek() === " ") this.at++;
    if (this.peek() === "{") {
      let depth = 0;
      const start = ++this.at;
      while (!this.done) {
        const c = this.next();
        if (c === "\\") this.at++;
        else if (c === "{") depth++;
        else if (c === "}" && depth-- === 0) return this.latex.slice(start, this.at - 1);
      }
      return this.latex.slice(start);
    }
    if (this.peek() === "\\") {
      this.at++;
      return `\\${this.command()}`;
    }
    return this.done ? "" : this.next();
  }

  // [n] after \sqrt
  option() {
    if (this.peek() !== "[") return null;
    const end = this.latex.indexOf("]", this.at);
    if (end < 0) return null;
    const value = this.latex.slice(this.at + 1, end);
    this.at = end + 1;
    return value;
  }
}

// A number, one letter or a single symbol needs no brackets around it in a/b or √x; anything else (2a, p − c) does,
// so it reads as one piece
function isSimple(runs: FormulaRun[]) {
  const text = runs.map((run) => run.text).join("").trim();
  return [...text].length <= 1 || /^\d+([.,]\d+)?$/.test(text);
}

function grouped(runs: FormulaRun[], style: Style): FormulaRun[] {
  return isSimple(runs) ? runs : [{ ...style, text: "(" }, ...runs, { ...style, text: ")" }];
}

function parse(latex: string, style: Style = {}): FormulaRun[] {
  const reader = new Reader(latex);
  const runs: FormulaRun[] = [];
  while (!reader.done) {
    const c = reader.next();
    if (c === "\\") runs.push(...command(reader, reader.command(), style, runs));
    else if (c === "^" || c === "_") {
      runs.push(...parse(reader.argument(), { ...style, ...(c === "^" ? { sup: true } : { sub: true }) }));
    } else if (c === "{") {
      reader.back();
      runs.push(...parse(reader.argument(), style));
    } else if (c === "}" || c === "&") continue;
    else if (/\s/.test(c)) continue;
    else if (/\p{L}/u.test(c)) runs.push({ ...style, text: c, italics: !style.bold });
    else runs.push(spaced({ ...style, text: OPERATORS[c] ?? c }, runs));
  }
  return runs;
}

// Space on both sides of = or +, as the chat draws them; a minus with nothing before it is a sign, not an operation
const SPACED = new Set("=+−<>±∓×÷⋅≤≥≠≈∼≡∝→←⇒⇐⇔↔↦∈∋⊂⊃⊆⊇∪∩");

function spaced(run: FormulaRun, before: FormulaRun[]): FormulaRun {
  const previous = before[before.length - 1]?.text.trimEnd().slice(-1);
  const isSign = !previous || "([{,".includes(previous) || SPACED.has(previous);
  if (!SPACED.has(run.text) || run.sup || run.sub || (isSign && (run.text === "−" || run.text === "+"))) return run;
  return { ...run, text: ` ${run.text} ` };
}

function command(reader: Reader, name: string, style: Style, before: FormulaRun[]): FormulaRun[] {
  if (name in SPACES) return SPACES[name] ? [{ ...style, text: SPACES[name] }] : [];
  if (IGNORED.has(name)) return [];
  if (name in GREEK) return [{ ...style, text: GREEK[name], ...(/^[a-z]/.test(name) ? { italics: true } : {}) }];
  if (name in SYMBOLS) return [spaced({ ...style, text: SYMBOLS[name] }, before)];
  if (NAMED.has(name)) return [{ ...style, text: `${name} ` }];
  if (TEXT_COMMANDS.has(name)) return [{ ...style, text: reader.argument(), isText: true }];
  if (name === "mathbf" || name === "boldsymbol") return parse(reader.argument(), { ...style, bold: true });
  if (name === "mathit") return parse(reader.argument(), style);
  if (FRACTIONS.has(name)) {
    const top = parse(reader.argument(), style);
    const bottom = parse(reader.argument(), style);
    return [...grouped(top, style), { ...style, text: "/" }, ...grouped(bottom, style)];
  }
  if (name === "sqrt") {
    const index = reader.option();
    const radicand = parse(reader.argument(), style);
    return [
      ...(index ? parse(index, { ...style, sup: true }) : []),
      { ...style, text: "√" },
      ...grouped(radicand, style),
    ];
  }
  // A command the PDF doesn't know keeps what it applies to, and its name if it has nothing to apply to
  return name ? [{ ...style, text: name }] : [];
}

// Neighbouring runs with the same style become one, so the PDF doesn't split the formula into many pieces
function merged(runs: FormulaRun[]) {
  return runs.reduce<FormulaRun[]>((all, run) => {
    const last = all[all.length - 1];
    const same =
      last &&
      last.italics === run.italics &&
      last.bold === run.bold &&
      last.sup === run.sup &&
      last.sub === run.sub &&
      last.isText === run.isText;
    if (same) all[all.length - 1] = { ...last, text: last.text + run.text };
    else all.push(run);
    return all;
  }, []);
}

export function formulaRuns(latex: string) {
  const runs = merged(parse(latex));
  // Spaces an operator or a function's name left at either end
  if (runs.length > 0) {
    runs[0] = { ...runs[0], text: runs[0].text.trimStart() };
    runs[runs.length - 1] = { ...runs[runs.length - 1], text: runs[runs.length - 1].text.trimEnd() };
  }
  return runs.filter((run) => run.text);
}
