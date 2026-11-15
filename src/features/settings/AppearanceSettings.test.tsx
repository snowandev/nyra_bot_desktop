// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLanguage, i18n } from "@/shared/i18n/i18n";
import type { LanguagePreference } from "@/shared/i18n/languages";
import { AppearanceSettings } from "./AppearanceSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await i18n.changeLanguage("es");
});

const heading = (text: string) => [...container.querySelectorAll("h4")].some((h) => h.textContent === text);

describe("choosing the interface's language", () => {
  it("offers Sistema, Español and English, and the whole panel follows the choice at once", async () => {
    let chosen: LanguagePreference = "system";
    const render = () =>
      root.render(
        <AppearanceSettings
          theme="dark"
          onThemeChange={() => {}}
          accent="violet"
          onAccentChange={() => {}}
          fontScale={1}
          onFontScaleChange={() => {}}
          language={chosen}
          onLanguageChange={(language) => {
            chosen = language;
            applyLanguage(language);
          }}
        />,
      );
    act(render);
    expect(heading("Tema")).toBe(true);
    const options = [...container.querySelectorAll<HTMLButtonElement>(".segmented button")];
    expect(options.map((b) => b.textContent)).toEqual([expect.stringMatching(/^Sistema \(/), "Español", "English"]);

    await act(async () => options[2].click());
    act(render);
    expect(chosen).toBe("en");
    expect(heading("Theme")).toBe(true);
    expect(heading("Language")).toBe(true);
    expect(document.documentElement.lang).toBe("en");
  });
});
