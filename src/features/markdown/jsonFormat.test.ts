import { describe, expect, it } from "vitest";
import { jsonShapes, mayBeJson } from "./jsonFormat";

describe("jsonShapes", () => {
  it("indents and compacts, keeping empty ones as they are", () => {
    const shapes = jsonShapes('{"nombre":"Marta","tags":[],"extra":{},"lista":[1,2]}');
    expect(shapes).toEqual({
      ok: true,
      formatted:
        '{\n  "nombre": "Marta",\n  "tags": [],\n  "extra": {},\n  "lista": [\n    1,\n    2\n  ]\n}',
      compact: '{"nombre":"Marta","tags":[],"extra":{},"lista":[1,2]}',
    });
  });

  it("never changes what it holds: big numbers, escapes, repeated keys", () => {
    const text = '{ "id": 12345678901234567890123, "texto": "caf\\u00e9 \\"bueno\\"", "a": 1, "a": 2.50e+3 }';
    const shapes = jsonShapes(text);
    expect(shapes.ok && shapes.compact).toBe(
      '{"id":12345678901234567890123,"texto":"caf\\u00e9 \\"bueno\\"","a":1,"a":2.50e+3}',
    );
  });

  it("says the line and column where it first breaks", () => {
    expect(jsonShapes('{\n  "a": 1\n  "b": 2\n}')).toEqual({ ok: false, line: 3, column: 3 });
    expect(jsonShapes('{"a": 1,}')).toEqual({ ok: false, line: 1, column: 9 });
    expect(jsonShapes('{"a": 1} // nota')).toEqual({ ok: false, line: 1, column: 10 });
    expect(jsonShapes("[1, 2] extra")).toEqual({ ok: false, line: 1, column: 8 });
    expect(jsonShapes("{'a': 1}")).toEqual({ ok: false, line: 1, column: 2 });
    expect(jsonShapes('"tab\there"')).toEqual({ ok: false, line: 1, column: 1 });
    expect(jsonShapes("")).toEqual({ ok: false, line: 1, column: 1 });
  });

  it("takes any JSON value, with spaces around", () => {
    expect(jsonShapes("  true \n")).toEqual({ ok: true, formatted: "true", compact: "true" });
    expect(jsonShapes("-0.5e-2").ok).toBe(true);
    expect(jsonShapes("01").ok).toBe(false);
  });
});

describe("jsonShapes with JSONC", () => {
  it("takes comments and trailing commas, and keeps it on several lines when it has comments", () => {
    const shapes = jsonShapes('{\n// puerto\n"port": 8080,}', true);
    expect(shapes).toEqual({ ok: true, formatted: '{\n  // puerto\n  "port": 8080,\n}', compact: null });
  });
});

describe("mayBeJson", () => {
  it("is only what starts as an object or a list", () => {
    expect(mayBeJson('  {"a": 1}')).toBe(true);
    expect(mayBeJson("[1]")).toBe(true);
    expect(mayBeJson("const a = {}")).toBe(false);
  });
});
