// Code reformatted by each language's own formatter (Ruff for Python, Biome and Malva for the web's languages, gofmt,
// clang-format…), built as WebAssembly. Each loads the first time its language is formatted: together they weigh
// about 9 MB. JSON has its own views (jsonFormat.ts).

type Format = (code: string) => string;

// Loads a formatter once; a failed load is tried again next time
function lazy<T>(load: () => Promise<T>) {
  let loading: Promise<T> | null = null;
  return () =>
    (loading ??= load().catch((e) => {
      loading = null;
      throw e;
    }));
}

const ruff = lazy(async () => {
  const { default: init, format } = await import("@wasm-fmt/ruff_fmt/vite");
  await init();
  return format;
});
const web = lazy(async () => {
  const { default: init, format } = await import("@wasm-fmt/web_fmt/vite");
  await init();
  return format;
});
const sql = lazy(async () => {
  const { default: init, format } = await import("@wasm-fmt/sql_fmt/vite");
  await init();
  return format;
});
const yaml = lazy(async () => {
  const { default: init, format } = await import("@wasm-fmt/yamlfmt/vite");
  await init();
  return format;
});
const go = lazy(async () => {
  const { default: init, format } = await import("@wasm-fmt/gofmt/vite");
  await init();
  return format;
});
const toml = lazy(async () => {
  const { default: init, format } = await import("@wasm-fmt/taplo_fmt/vite");
  await init();
  return format;
});
const clang = lazy(async () => {
  const { default: init, format } = await import("@wasm-fmt/clang-format/vite");
  await init();
  return format;
});

// Spaces, as most code on the web is written: Biome indents with tabs by default, which show very wide in a reply
const WEB_LAYOUT = { indentStyle: "space", indentWidth: 2 } as const;

// web_fmt and clang-format tell the language by a file name
const inWeb = (file: string) => async (): Promise<Format> => {
  const format = await web();
  return (code) => format(code, file, WEB_LAYOUT);
};
const inClang = (file: string) => async (): Promise<Format> => {
  const format = await clang();
  return (code) => format(code, file);
};

const FORMATTERS: Record<string, () => Promise<Format>> = {
  python: ruff,
  javascript: inWeb("index.js"),
  jsx: inWeb("index.jsx"),
  typescript: inWeb("index.ts"),
  tsx: inWeb("index.tsx"),
  css: inWeb("style.css"),
  scss: inWeb("style.scss"),
  less: inWeb("style.less"),
  html: inWeb("index.html"),
  vue: inWeb("index.vue"),
  svelte: inWeb("index.svelte"),
  graphql: inWeb("schema.graphql"),
  sql,
  yaml,
  go,
  toml,
  c: inClang("main.c"),
  cpp: inClang("main.cpp"),
  java: inClang("main.java"),
  csharp: inClang("main.cs"),
  objectivec: inClang("main.m"),
  protobuf: inClang("main.proto"),
};

// How a language is named in a block or by a file's extension, as FORMATTERS names it
const ALIASES: Record<string, string> = {
  py: "python",
  python3: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  htm: "html",
  gql: "graphql",
  postgres: "sql",
  postgresql: "sql",
  mysql: "sql",
  sqlite: "sql",
  yml: "yaml",
  golang: "go",
  h: "c",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  "c#": "csharp",
  objc: "objectivec",
  m: "objectivec",
  proto: "protobuf",
};

const formatterOf = (language: string) => {
  const name = language.trim().toLowerCase();
  return FORMATTERS[ALIASES[name] ?? name] ?? null;
};

// Whether Nyra can reformat code in this language
export const canFormat = (language: string | null) => !!language && formatterOf(language) !== null;

// The code reformatted; rejects with the formatter's own words when it can't read it (a syntax error)
export async function formatCode(code: string, language: string) {
  const load = formatterOf(language);
  if (!load) throw new Error(`No formatter for ${language}`);
  const format = await load();
  return format(code).replace(/\n+$/, "");
}
