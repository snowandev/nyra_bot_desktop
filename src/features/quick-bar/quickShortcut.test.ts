import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK_SHORTCUT } from "@/shared/storage/settings";
import { acceleratorFromKeys, acceleratorLabel } from "./quickShortcut";

const press = (code: string, keys: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  code,
  ...keys,
});

describe("acceleratorFromKeys", () => {
  it("takes the modifiers and the key by its place on the keyboard", () => {
    expect(acceleratorFromKeys(press("KeyK", { metaKey: true, shiftKey: true }))).toBe("Shift+Super+KeyK");
    expect(acceleratorFromKeys(press("Space", { ctrlKey: true, altKey: true }))).toBe("Control+Alt+Space");
  });

  it("waits while only modifiers are held, and refuses a key with Shift alone or nothing", () => {
    expect(acceleratorFromKeys(press("ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(acceleratorFromKeys(press("MetaRight", { metaKey: true }))).toBeNull();
    expect(acceleratorFromKeys(press("KeyA", { shiftKey: true }))).toBeNull();
    expect(acceleratorFromKeys(press("KeyA"))).toBeNull();
  });
});

describe("acceleratorLabel", () => {
  it("writes it as each system does", () => {
    expect(acceleratorLabel(DEFAULT_QUICK_SHORTCUT, "mac")).toBe("⌃⇧Espacio");
    expect(acceleratorLabel(DEFAULT_QUICK_SHORTCUT, "windows")).toBe("Ctrl+Shift+Espacio");
    expect(acceleratorLabel("Control+Alt+KeyK", "mac")).toBe("⌃⌥K");
    expect(acceleratorLabel("Shift+Super+Digit1", "windows")).toBe("Shift+Win+1");
    expect(acceleratorLabel("Shift+Super+Slash", "linux")).toBe("Shift+Super+/");
  });
});
