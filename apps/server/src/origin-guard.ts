/**
 * Host and Origin checks for the HTTP and WebSocket surface.
 *
 * The per-incident token is the real gate; this closes the browser-side doors around it:
 * DNS rebinding (an attacker's domain that resolves to this machine) and cross-site WebSocket
 * connections. Both depend on a browser sending a DNS name that is not ours, so the rule is
 * hostname-based: `localhost` and IP literals are always fine (including a LAN demo at
 * http://192.168.x.x:5173), and any other name must be listed in EMBER_ALLOWED_HOSTS
 * (comma separated, hostnames only, for example `demo-laptop.local`).
 */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Hostnames from EMBER_ALLOWED_HOSTS, lower-cased, without ports. */
export function allowedHostsFromEnv(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** The hostname part of a `Host` header value (`host`, `host:port`, `[::1]:port`), lower-cased; null if unparsable. */
export function hostnameOfHostHeader(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end > 0 ? trimmed.slice(1, end) : null;
  }
  const colon = trimmed.indexOf(":");
  const host = colon === -1 ? trimmed : trimmed.slice(0, colon);
  return host.length > 0 ? host : null;
}

function isIpLiteral(hostname: string): boolean {
  return IPV4.test(hostname) || hostname.includes(":");
}

export function isAllowedHostname(hostname: string, extraHosts: readonly string[] = []): boolean {
  const name = hostname.toLowerCase();
  return name === "localhost" || isIpLiteral(name) || extraHosts.includes(name);
}

/** A missing Host (HTTP/1.0 or a raw client) is allowed: the attack needs a browser, which always sends one. */
export function isAllowedHostHeader(host: string | undefined, extraHosts: readonly string[] = []): boolean {
  if (host === undefined) return true;
  const hostname = hostnameOfHostHeader(host);
  return hostname !== null && isAllowedHostname(hostname, extraHosts);
}

/** The authority of an `Origin` such as `http://user@host:5173`; the opaque `null` origin and garbage do not match. */
const ORIGIN_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)\/?$/i;

/** A missing Origin means a non-browser client and is allowed; the opaque `null` origin is not. */
export function isAllowedOrigin(origin: string | undefined, extraHosts: readonly string[] = []): boolean {
  if (origin === undefined) return true;
  const match = ORIGIN_AUTHORITY.exec(origin.trim());
  if (match === null) return false;
  const authority = match[1]!;
  const hostname = hostnameOfHostHeader(authority.slice(authority.lastIndexOf("@") + 1));
  return hostname !== null && isAllowedHostname(hostname, extraHosts);
}
