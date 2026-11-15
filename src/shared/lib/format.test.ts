import { describe, expect, it } from "vitest";
import {
  fileSlug,
  formatBytes,
  formatDuration,
  formatRemaining,
  formatShare,
  formatSpeed,
  formatStorage,
} from "./format";

describe("formatDuration", () => {
  it("shows seconds with a decimal comma, then minutes", () => {
    expect(formatDuration(4800)).toBe("4,8 s");
    expect(formatDuration(72_000)).toBe("1 min 12 s");
  });
});

describe("formatBytes", () => {
  it("picks the unit and uses a decimal comma", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3,0 MB");
  });
});

describe("model sizes and downloads", () => {
  it("uses decimal units, like Ollama", () => {
    expect(formatStorage(5.2e9)).toBe("5,2 GB");
    expect(formatStorage(274e6)).toBe("274 MB");
    expect(formatSpeed(38e6)).toBe("38 MB/s");
  });

  it("says how long is left", () => {
    expect(formatRemaining(40)).toBe("quedan 40 s");
    expect(formatRemaining(150)).toBe("quedan 3 min");
    expect(formatRemaining(5400)).toBe("quedan 1,5 h");
  });
});

it("never shows a small share as 0 %", () => {
  expect(formatShare(0)).toBe("0 %");
  expect(formatShare(0.002)).toBe("<1 %");
  expect(formatShare(0.2)).toBe("20 %");
});

describe("fileSlug", () => {
  it("keeps the letters of any script and drops the accents of Latin ones, as before", () => {
    expect(fileSlug("东京会议 纪要", 64)).toBe("东京会议-纪要");
    expect(fileSlug("会議のメモ", 64)).toBe("会議のメモ");
    expect(fileSlug("회의 기록", 64)).toBe("회의-기록");
    expect(fileSlug("Informe del año", 64)).toBe("informe-del-ano");
    expect(fileSlug("../../etc/passwd", 64)).toBe("etc-passwd");
    expect(fileSlug("东京会议", 2)).toBe("东京");
  });
});
