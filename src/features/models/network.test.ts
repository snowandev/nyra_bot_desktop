import { describe, expect, it } from "vitest";
import { isUnencryptedRemote, remoteHostOf } from "./network";

describe("isUnencryptedRemote", () => {
  it("doesn't warn for this computer or for https", () => {
    for (const url of ["http://localhost:11434", "http://127.0.0.1:11434", "http://[::1]:11434", "https://ollama.example.com"]) {
      expect(isUnencryptedRemote(url)).toBe(false);
    }
  });

  it("warns for plain http to another machine, look-alike names included", () => {
    for (const url of ["http://192.168.1.20:11434", "http://ollama.example.com", "http://localhost.evil.com"]) {
      expect(isUnencryptedRemote(url)).toBe(true);
    }
  });

  it("stays quiet while the address is still being typed", () => {
    expect(isUnencryptedRemote("htt")).toBe(false);
  });
});

describe("remoteHostOf", () => {
  it("names the other computer, and nothing for this one", () => {
    expect(remoteHostOf("http://192.168.1.20:11434")).toBe("192.168.1.20");
    expect(remoteHostOf("http://localhost:11434")).toBeNull();
    expect(remoteHostOf("http://127.0.0.1:11434/")).toBeNull();
    expect(remoteHostOf("http://[::1]:11434")).toBeNull();
    expect(remoteHostOf("no es una url")).toBeNull();
  });
});
