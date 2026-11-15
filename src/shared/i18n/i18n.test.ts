import { describe, expect, it } from "vitest";
import { i18n, resolveLanguage } from "./i18n";
import { LANGUAGES, systemLanguage } from "./languages";
import en from "./locales/en.json";
import es from "./locales/es.json";

const CATALOGS = { es, en };
const PLURAL = /_(zero|one|two|few|many|other)$/;

type Tree = { [key: string]: string | Tree };

function textsOf(tree: Tree, prefix = ""): Map<string, string> {
  const texts = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") texts.set(path, value);
    else for (const [inner, text] of textsOf(value, path)) texts.set(inner, text);
  }
  return texts;
}

// "{{count, number}}" and "{{name}}" give "count" and "name"
const variablesOf = (text: string) => [...text.matchAll(/\{\{\s*(\w+)/g)].map((m) => m[1]).sort();

describe("the catalogs", () => {
  const spanish = textsOf(es);

  it("has every language in the list", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)("%s has the same texts, with the same data, as Spanish", (language) => {
    const texts = textsOf(CATALOGS[language]);
    const base = (texts: Map<string, string>) => new Set([...texts.keys()].map((k) => k.replace(PLURAL, "")));
    expect([...base(texts)].sort()).toEqual([...base(spanish)].sort());
    for (const [key, text] of texts) {
      const original = spanish.get(key) ?? spanish.get(key.replace(PLURAL, "_other"));
      expect(variablesOf(text), key).toEqual(variablesOf(original ?? ""));
    }
  });

  it.each(LANGUAGES)("%s has every plural form its language uses", (language) => {
    const texts = textsOf(CATALOGS[language]);
    const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
    const plurals = new Set([...texts.keys()].filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
    for (const key of plurals) for (const form of forms) expect(texts.has(`${key}_${form}`), `${key}_${form}`).toBe(true);
  });
});

describe("choosing the language", () => {
  it("follows the first of the computer's languages that Nyra has, and English otherwise", () => {
    expect(systemLanguage(["es-MX", "en-US"])).toBe("es");
    expect(systemLanguage(["de-DE", "es-ES"])).toBe("es");
    expect(systemLanguage(["fr-FR", "de-DE"])).toBe("en");
    expect(systemLanguage([])).toBe("en");
  });

  it("uses the chosen one when it isn't «Sistema»", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("es")).toBe("es");
  });

  it("writes counts with the plural and the number format of each language", async () => {
    expect(i18n.t("common.conversations", { count: 1 })).toBe("1 conversación");
    expect(i18n.t("common.conversations", { count: 1_000_000 })).toBe("1.000.000 conversaciones");
    await i18n.changeLanguage("en");
    expect(i18n.t("common.conversations", { count: 12_345 })).toBe("12,345 conversations");
    await i18n.changeLanguage("es");
  });
});
