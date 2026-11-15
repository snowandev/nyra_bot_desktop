import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));

const { request } = await import("./ollamaApi");

describe("request", () => {
  beforeEach(() => fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 })));

  it("sends an empty Origin so the HTTP plugin leaves it out, and keeps the other headers", async () => {
    await request("http://localhost:11434/api/tags", { headers: { Authorization: "Bearer x" } });
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Origin")).toBe("");
    expect(headers.get("Authorization")).toBe("Bearer x");
  });
});
