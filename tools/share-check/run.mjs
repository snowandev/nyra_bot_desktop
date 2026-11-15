// npm run check:share — draws the sample reply (sample.ts) as Nyra shares it: the image in light and dark themes, the
// PDF page by page and the Markdown file, in WebKit (the engine of macOS and Linux) and Chromium (the one of WebView2
// on Windows). Everything goes to tools/share-check/out/ to be looked at; it fails if a page reports an error.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const project = resolve(root, "../..");
const out = join(root, "out");
const ENGINES = { webkit, chromium };
const THEMES = ["light", "dark"];
// Large replies with diagrams take a while to draw, the PDF more
const STEP_TIMEOUT_MS = 120_000;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  plugins: [react()],
  resolve: { alias: { "@": join(project, "src") } },
  define: { PDF_FONTS_URL: JSON.stringify(`/@fs${join(project, "node_modules/pdfjs-dist/standard_fonts")}/`) },
  server: { port: 0, fs: { allow: [project] } },
});
await server.listen();
const address = server.resolvedUrls.local[0];

const errors = [];
const written = [];
const save = (name, data) => {
  writeFileSync(join(out, name), data);
  written.push(name);
};

async function open(browser, engine, theme) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.on("pageerror", (error) => errors.push(`${engine} ${theme}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${engine} ${theme}: ${message.text()}`);
  });
  await page.goto(`${address}?theme=${theme}`);
  await page.waitForFunction(() => "shareCheck" in window);
  return page;
}

try {
  for (const [engine, launcher] of Object.entries(ENGINES)) {
    const browser = await launcher.launch();
    try {
      for (const theme of THEMES) {
        const page = await open(browser, engine, theme);
        const started = Date.now();
        const image = await page.evaluate(() => window.shareCheck.image());
        save(`${engine}-image-${theme}.png`, Buffer.from(image, "base64"));
        console.log(`${engine} ${theme}: image in ${Date.now() - started} ms`);
        if (theme === "light") {
          const pages = await page.evaluate(() => window.shareCheck.pdf());
          pages.forEach((png, i) => save(`${engine}-pdf-page-${i + 1}.png`, Buffer.from(png, "base64")));
          if (engine === "webkit") save("reply.md", await page.evaluate(() => window.shareCheck.markdown()));
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

console.log(`\nWritten to tools/share-check/out/:\n${written.map((name) => `  ${name}`).join("\n")}`);
if (errors.length > 0) {
  console.error(`\nErrors in the page:\n${errors.map((error) => `  ${error}`).join("\n")}`);
  process.exit(1);
}
