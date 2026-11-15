// The fonts a captured image carries, written out by Nyra instead of left to the capture library: picking one format
// per font, the library skipped some faces at random, and their text came out in another weight or font. Each font
// file is read once per session.

const WOFF2_URL = /url\((["']?)([^"')]+)\1\)\s*format\((["']?)woff2\3\)/;
const fontData = new Map<string, Promise<string>>();

function dataUrlOf(url: string) {
  let data = fontData.get(url);
  if (!data) {
    data = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${url}`);
        return response.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      );
    // A failed read is tried again next time
    data.catch(() => fontData.delete(url));
    fontData.set(url, data);
  }
  return data;
}

const familyName = (family: string) => family.split(",")[0].trim().replace(/["']/g, "").toLowerCase();

// The first family of every element: the one its text is drawn with when its font is there
function familiesIn(node: HTMLElement) {
  const families = new Set<string>();
  for (const element of [node, ...node.querySelectorAll("*")]) families.add(familyName(getComputedStyle(element).fontFamily));
  return families;
}

function fontFaceRules(rules: CSSRuleList, found: CSSFontFaceRule[] = []) {
  for (const rule of rules) {
    if (rule instanceof CSSFontFaceRule) found.push(rule);
    else if (rule instanceof CSSImportRule && rule.styleSheet) fontFaceRules(rule.styleSheet.cssRules, found);
    else if ("cssRules" in rule) fontFaceRules((rule as CSSGroupingRule).cssRules, found);
  }
  return found;
}

function readableRules(sheet: CSSStyleSheet) {
  try {
    return sheet.cssRules;
  } catch {
    // A style sheet from another origin can't be read; Nyra's fonts all come with the app
    return null;
  }
}

async function embeddedFace(rule: CSSFontFaceRule) {
  const url = rule.style.getPropertyValue("src").match(WOFF2_URL)?.[2];
  if (!url) return "";
  const absolute = new URL(url, rule.parentStyleSheet?.href ?? document.baseURI).href;
  const descriptors = ["font-family", "font-style", "font-weight", "font-stretch", "unicode-range"]
    .map((name) => [name, rule.style.getPropertyValue(name)])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  return `@font-face { ${descriptors} src: url("${await dataUrlOf(absolute)}") format("woff2"); }`;
}

// The @font-face rules for the fonts the node's text uses, with each file inside as woff2
export async function fontFacesFor(node: HTMLElement) {
  const families = familiesIn(node);
  const rules = [...document.styleSheets]
    .flatMap((sheet) => {
      const rules = readableRules(sheet);
      return rules ? fontFaceRules(rules) : [];
    })
    .filter((rule) => families.has(familyName(rule.style.getPropertyValue("font-family"))));
  // A font that can't be read leaves its text in the next font of the list, not the image unmade
  const faces = await Promise.all(rules.map((rule) => embeddedFace(rule).catch(() => "")));
  return faces.filter(Boolean).join("\n");
}
