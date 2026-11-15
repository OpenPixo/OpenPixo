/**
 * Text an agent wrote for the CLI to read, decoded by its byte order mark.
 *
 * Agents on Windows write files from PowerShell 5.1, which marks what it
 * writes: `Set-Content -Encoding UTF8` and `Out-File -Encoding utf8` start with
 * the UTF-8 mark, and `>` / `Out-File` default to UTF-16 LE. Read as plain
 * UTF-8, the first gives JSON an invisible U+FEFF before the first brace and
 * the second gives it every other byte as NUL, and `JSON.parse` refuses both.
 * Without a mark the bytes are UTF-8.
 */
export function decodeAgentTextBytes(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2, 2 + ((buffer.length - 2) & ~1)));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return buffer.toString('utf8');
}
