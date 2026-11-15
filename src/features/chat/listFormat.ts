import { currentLocale } from "@/shared/i18n/i18n";

// "a, b y c" in Spanish, "a, b, and c" in English: each language joins a list its own way
export const joinedList = (items: string[]) =>
  new Intl.ListFormat(currentLocale(), { style: "long", type: "conjunction" }).format(items);
