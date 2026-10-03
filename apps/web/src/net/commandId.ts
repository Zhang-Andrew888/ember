/**
 * Unique id for a command's idempotency key. `crypto.randomUUID()` only exists in
 * secure contexts (https or localhost) and throws on a plain-http page served from
 * another host, which is exactly how a LAN demo is opened. Falls back to a v4 UUID
 * built from `getRandomValues` (available everywhere), then to Math.random as a
 * last resort (uniqueness, not secrecy, is all an idempotency key needs).
 */
export function newCommandId(cryptoLike: Partial<Pick<Crypto, "randomUUID" | "getRandomValues">> | undefined = globalThis.crypto): string {
  if (cryptoLike?.randomUUID) {
    try {
      return cryptoLike.randomUUID();
    } catch {
      /* insecure context: fall through */
    }
  }
  const bytes = new Uint8Array(16);
  if (cryptoLike?.getRandomValues) cryptoLike.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
