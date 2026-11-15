// A text file's bytes as text, in the encoding it was saved in: UTF-8, UTF-16 (Windows writes it with a mark at the
// start, and some programs without one) or Windows-1252, which older Windows programs use. null when it isn't text.
export function decodedText(bytes: Uint8Array): string | null {
  const encoding = encodingOf(bytes);
  const text =
    encoding === "utf-8"
      ? (strictUtf8(bytes) ?? new TextDecoder("windows-1252").decode(bytes))
      : new TextDecoder(encoding).decode(bytes);
  return text.includes("\0") ? null : text;
}

const SAMPLE_BYTES = 4000;

function encodingOf(bytes: Uint8Array): "utf-8" | "utf-16le" | "utf-16be" {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // Without the mark, text in UTF-16 that is mostly Latin letters has a zero in every other byte
  const sample = bytes.subarray(0, SAMPLE_BYTES);
  let evenZeros = 0;
  let oddZeros = 0;
  sample.forEach((byte, i) => {
    if (byte === 0) {
      if (i % 2 === 0) evenZeros++;
      else oddZeros++;
    }
  });
  const pairs = sample.length / 2;
  if (oddZeros > pairs * 0.3 && evenZeros < pairs * 0.05) return "utf-16le";
  if (evenZeros > pairs * 0.3 && oddZeros < pairs * 0.05) return "utf-16be";
  return "utf-8";
}

function strictUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8: read as Windows-1252, which gives every byte a character
    return null;
  }
}
