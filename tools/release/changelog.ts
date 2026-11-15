// Run by the release workflow: `node tools/release/changelog.ts <version> <out folder>`. Checks the version is the
// app's, the updater has its public key and the version is in both changelogs, then writes changelog.json (what Nyra reads) and release-notes.md (the release
// page). Node runs this TypeScript as it is.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mergeChangelogs, releaseBody } from "../../src/features/updates/changelog.ts";

const [version, out] = process.argv.slice(2);
if (!version || !out) throw new Error("Usage: node tools/release/changelog.ts <version> <out folder>");

type Config = { version: string; plugins?: { updater?: { pubkey?: string } } };
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as Config;
if (config.version !== version) {
  throw new Error(`The tag is ${version} but tauri.conf.json says ${config.version}: update the version first`);
}
// Without it the installed copies couldn't check the new version's signature, so they would never update
if (!config.plugins?.updater?.pubkey) throw new Error("tauri.conf.json has no updater public key (plugins.updater.pubkey)");

const changelog = mergeChangelogs(readFileSync("CHANGELOG.md", "utf8"), readFileSync("CHANGELOG.es.md", "utf8"));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "changelog.json"), JSON.stringify(changelog));
writeFileSync(join(out, "release-notes.md"), releaseBody(changelog, version));
console.log(`Release notes for ${version} written to ${out}`);
