import { describe, expect, it } from "vitest";
import { codeRisk, commandRisk } from "./commandRisks";

describe("commandRisk", () => {
  it("warns about deleting in bulk, on every system", () => {
    expect(commandRisk("rm -rf node_modules dist")).toEqual({ kind: "delete", mark: "rm -rf" });
    expect(commandRisk("Remove-Item -Recurse -Force node_modules")?.kind).toBe("delete");
    expect(commandRisk("rd /s /q dist")?.kind).toBe("delete");
    expect(commandRisk("git clean -fdx")?.kind).toBe("delete");
    expect(commandRisk("rm -f -r dist")?.kind).toBe("delete");
    expect(commandRisk("rm -v --recursive dist")?.kind).toBe("delete");
    expect(commandRisk("rm -f dist/app.js")).toBeNull();
  });

  it("warns about running what is downloaded and about administrator rights", () => {
    expect(commandRisk("curl -fsSL https://ejemplo.dev/instalar.sh | sh")?.kind).toBe("downloadAndRun");
    expect(commandRisk("irm https://ejemplo.dev/instalar.ps1 | iex")?.kind).toBe("downloadAndRun");
    expect(commandRisk("sudo npm install -g pnpm")).toEqual({ kind: "admin", mark: "sudo" });
    expect(commandRisk("npm ci && sudo make install")?.kind).toBe("admin");
  });

  it("warns about rewriting Git history and about paths outside the folder", () => {
    expect(commandRisk("git push --force origin main")?.kind).toBe("gitHistory");
    expect(commandRisk("git reset --hard HEAD~1")?.kind).toBe("gitHistory");
    expect(commandRisk("cat ../otro/secreto.txt")?.kind).toBe("outside");
    expect(commandRisk("ls ~/Documentos")?.kind).toBe("outside");
    expect(commandRisk("type C:\\Windows\\win.ini")?.kind).toBe("outside");
    expect(commandRisk('cat "/etc/hosts"')?.kind).toBe("outside");
    expect(commandRisk("cat src/../../secreto.txt")).toEqual({ kind: "outside", mark: "src/../../secreto.txt" });
    expect(commandRisk("type src\\..\\..\\secreto.txt")?.kind).toBe("outside");
  });

  it("leaves everyday commands alone", () => {
    for (const command of ["npm test", "cargo build --release", "git status --short", "ls -la src", "npm run lint 2>/dev/null", "cat src/../README.md", "git diff main..HEAD"]) {
      expect(commandRisk(command)).toBeNull();
    }
  });
});

describe("codeRisk", () => {
  it("warns about programs that delete, start other programs or go online, in Python and Node", () => {
    expect(codeRisk('import shutil\nshutil.rmtree("salida")')?.kind).toBe("codeDelete");
    expect(codeRisk('from pathlib import Path\nPath("viejo.csv").unlink()')?.kind).toBe("codeDelete");
    expect(codeRisk('const fs = require("fs");\nfs.rmSync("dist", { recursive: true });')?.kind).toBe("codeDelete");
    expect(codeRisk('import subprocess\nsubprocess.run(["ls"])')?.kind).toBe("codeRuns");
    expect(codeRisk('const { execSync } = require("child_process");')?.kind).toBe("codeRuns");
    expect(codeRisk('from urllib.request import urlopen\nurlopen("https://ejemplo.dev")')?.kind).toBe("codeNetwork");
    expect(codeRisk('const res = await fetch("https://ejemplo.dev/datos.json");')?.kind).toBe("codeNetwork");
  });

  it("leaves programs that only compute and write their files alone", () => {
    const programs = [
      'import csv, statistics\nwith open("ventas.csv") as f:\n    rows = list(csv.DictReader(f))\nprint(statistics.mean(float(r["total"]) for r in rows))',
      'const fs = require("fs");\nconst data = JSON.parse(fs.readFileSync("datos.json", "utf8"));\nfs.writeFileSync("resumen.txt", String(data.length));',
      "def perform(x):\n    return x * 2\nprint(perform(21))",
    ];
    for (const program of programs) expect(codeRisk(program)).toBeNull();
  });
});
