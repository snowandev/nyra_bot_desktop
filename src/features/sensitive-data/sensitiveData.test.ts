import { describe, expect, it } from "vitest";
import { cloudDestinations, findSensitiveData, hideSecrets, labelsOf, maskSecret, withSecretsHidden } from "./sensitiveData";

const labels = (text: string) => labelsOf(findSensitiveData(text));

describe("findSensitiveData", () => {
  it("recognizes provider keys and tells Anthropic from OpenAI", () => {
    expect(labels("mi clave es sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx")).toEqual(["API Key de Anthropic"]);
    expect(labels("OPENAI: sk-proj-AbCdEfGhIjKlMnOpQrStUvWx12")).toEqual(["API Key de OpenAI"]);
    expect(labels("AKIAIOSFODNN7EXAMPLE")).toEqual(["Clave de acceso de AWS"]);
    expect(labels("token ghp_" + "a".repeat(36))).toEqual(["Token de GitHub"]);
    expect(labels("-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn...")).toEqual(["Clave privada"]);
  });

  it("counts a key once even when it is also an .env secret", () => {
    expect(labels("ANTHROPIC_API_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx\nDB_PASSWORD=s3cr3t-Pa55")).toEqual([
      "API Key de Anthropic",
      "Contraseña o secreto",
    ]);
  });

  it("finds secrets in .env files and quoted values", () => {
    expect(labels("DB_HOST=localhost\nDB_PASSWORD=s3cr3t-Pa55")).toEqual(["Contraseña o secreto"]);
    expect(labels('{ "password": "hunter2hunter2" }')).toEqual(["Contraseña o secreto"]);
    expect(labels("contraseña: 'MiClaveSegura9'")).toEqual(["Contraseña o secreto"]);
  });

  it("leaves out placeholders and code that only names a secret", () => {
    expect(labels("API_KEY=<tu-clave>")).toEqual([]);
    expect(labels("API_KEY=your_api_key_here")).toEqual([]);
    expect(labels('"apiKey": "xxxxxxxxxxxx"')).toEqual([]);
    expect(labels("const apiKey = config.apiKey;")).toEqual([]);
    expect(labels("password: string;")).toEqual([]);
    expect(labels("La contraseña debe tener 8 caracteres.")).toEqual([]);
  });

  it("recognizes card numbers by their checksum, not any long number", () => {
    expect(labels("Mi tarjeta: 4111 1111 1111 1111")).toEqual(["Número de tarjeta"]);
    expect(labels("4111-1111-1111-1112")).toEqual([]);
    expect(labels("timestamp 1760140800000")).toEqual([]);
    expect(labels("pedido 123456")).toEqual([]);
  });

  it("says where each one is, counts a repeated value once and ignores images", () => {
    const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx";
    const env = { id: "e", kind: "text" as const, name: "config.txt", mimeType: "text/plain", data: "SECRET_TOKEN=abc123def456" };
    const image = { id: "i", kind: "image" as const, name: "x.png", mimeType: "image/png", data: key };
    const found = findSensitiveData(`Hola\n${key}\notra vez ${key}`, [env, image]);
    expect(found.map((m) => m.place)).toEqual([
      { type: "message", line: 2 },
      { type: "file", id: "e", name: "config.txt" },
    ]);
  });
});

describe("maskSecret", () => {
  const masked = (text: string) => maskSecret(findSensitiveData(text)[0]);

  it("shows enough to recognize each secret without exposing it", () => {
    expect(masked("sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx")).toBe("sk-ant-…UvWx");
    expect(masked("4111 1111 1111 1111")).toBe("•••• 1111");
    expect(masked("DB_PASSWORD=s3cr3t-Pa55")).toBe("DB_PASSWORD=••••••••");
    expect(masked('"password": "hunter2hunter2"')).toBe("password: ••••••••");
  });
});

describe("cloudDestinations", () => {
  const models = [
    { id: "qwen", name: "qwen3.8:27b-mxfp8", description: "", providerId: "ollama" },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", description: "", providerId: "anthropic" },
  ];
  // One entry per message: the model that wrote it, empty for the user's
  it("marks every earlier message once a reply comes from a cloud provider", () => {
    const writtenBy = ["", "qwen3.8:27b-mxfp8", "", "Claude Opus 5.5", ""];
    expect(cloudDestinations(writtenBy, models)).toEqual(["Anthropic", "Anthropic", "Anthropic", undefined, undefined]);
  });

  it("leaves local-only conversations and unknown models alone", () => {
    expect(cloudDestinations(["", "qwen3.8:27b-mxfp8"], models)).toEqual([undefined, undefined]);
    expect(cloudDestinations(["", "Modelo borrado"], models)).toEqual([undefined, undefined]);
  });
});

describe("Java properties and YAML", () => {
  const found = (text: string) => findSensitiveData(text).map((m) => m.value);

  it("finds secrets whose name ends in the secret word", () => {
    expect(found("mail.password=Abc12345")).toEqual(["mail.password=Abc12345"]);
    expect(found("ai_comparison.client_secret=k9Qz81mPa")).toEqual(["ai_comparison.client_secret=k9Qz81mPa"]);
    expect(found("spring:\n  datasource:\n    password: hunter2222")).toEqual(["    password: hunter2222"]);
  });

  it("leaves out settings that only mention the word, empty values and code", () => {
    expect(found("token.validitySeconds=3600")).toEqual([]);
    expect(found("tokenUrl=https://auth.example.org/token")).toEqual([]);
    expect(found("mail.password=")).toEqual([]);
    expect(found("  password: string;")).toEqual([]);
    expect(found("token = getToken()")).toEqual([]);
    expect(found("db.password=${DB_PASSWORD}")).toEqual([]);
  });
});

describe("withSecretsHidden", () => {
  it("keeps each setting's name and hides its value, line by line", () => {
    const text = [
      "mail.host=smtp.lirquen.cl",
      "mail.password=Abc12345",
      'const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv";',
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA1",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const { text: hidden, hidden: count } = withSecretsHidden(text);
    expect(hidden.split("\n")).toEqual([
      "mail.host=smtp.lirquen.cl",
      "mail.password=[hidden]",
      'const key = "[hidden key]";',
      "-----BEGIN RSA PRIVATE KEY-----",
      "[hidden]",
      "-----END RSA PRIVATE KEY-----",
    ]);
    expect(count).toBe(3);
  });

  it("leaves a file without secrets as it is", () => {
    expect(withSecretsHidden("const a = 1;\nexport default a;")).toEqual({ text: "const a = 1;\nexport default a;", hidden: 0 });
  });
});

describe("hideSecrets", () => {
  it("hides the values in the message and its files, keeping each setting's name, and isn't fooled twice", () => {
    const message = "Conecta con esto:\nDB_PASSWORD=Tr3sCaballos!2026\ny la clave sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";
    const env = {
      id: "f1",
      kind: "text" as const,
      name: "config.env",
      mimeType: "text/plain",
      // Made up, and joined at run time so no secret scanner takes the source for a real key
      data: `PORT=8080\nSTRIPE_SECRET=${["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_")}\n`,
    };
    const sheet = { ...env, id: "f2", name: "claves.xlsx", data: "| 2 | api_key | 4111 1111 1111 1111 |", workbook: "BASE64" };
    const result = hideSecrets(message, [env, sheet, { ...env, id: "f3", name: "nada.txt", data: "hola" }]);
    expect(result.text).toBe("Conecta con esto:\nDB_PASSWORD=[oculto]\ny la clave [clave oculta]");
    expect(result.files.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(result.files[0].data).toBe("PORT=8080\nSTRIPE_SECRET=[clave oculta]\n");
    expect(result.files[1].data).toContain("[tarjeta oculta]");
    expect("workbook" in result.files[1]).toBe(false);
    expect(result.hidden).toBe(4);
    expect(findSensitiveData(result.text, result.files)).toEqual([]);
  });
});
