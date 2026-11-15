// A response read line by line as it arrives; a line can be split across network chunks. If handling a line throws
// (an unreadable line, a stop), the reading is cancelled, so the connection doesn't stay open behind the error.
export async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(onLine);
    }
    const last = buffer + decoder.decode();
    if (last) onLine(last);
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
}
