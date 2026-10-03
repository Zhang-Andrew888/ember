import { describe, expect, it } from "vitest";
import {
  allowedHostsFromEnv,
  hostnameOfHostHeader,
  isAllowedHostHeader,
  isAllowedHostname,
  isAllowedOrigin,
} from "./origin-guard.js";

describe("origin-guard hostnames", () => {
  it("allows localhost and IP literals, including a LAN address and IPv6", () => {
    for (const name of ["localhost", "127.0.0.1", "192.168.1.20", "::1"]) expect(isAllowedHostname(name)).toBe(true);
  });

  it("rejects other DNS names unless they are listed", () => {
    expect(isAllowedHostname("evil.example.com")).toBe(false);
    expect(isAllowedHostname("rebind.localhost.evil.com")).toBe(false);
    expect(isAllowedHostname("demo-laptop.local")).toBe(false);
    expect(isAllowedHostname("Demo-Laptop.local", ["demo-laptop.local"])).toBe(true);
  });

  it("reads EMBER_ALLOWED_HOSTS as a trimmed, lower-cased list", () => {
    expect(allowedHostsFromEnv(" Demo-Laptop.local , ,other.local")).toEqual(["demo-laptop.local", "other.local"]);
    expect(allowedHostsFromEnv(undefined)).toEqual([]);
    expect(allowedHostsFromEnv("")).toEqual([]);
  });
});

describe("origin-guard Host header", () => {
  it("extracts the hostname from host, host:port and [ipv6]:port", () => {
    expect(hostnameOfHostHeader("localhost:3000")).toBe("localhost");
    expect(hostnameOfHostHeader("127.0.0.1")).toBe("127.0.0.1");
    expect(hostnameOfHostHeader("[::1]:3000")).toBe("::1");
    expect(hostnameOfHostHeader("")).toBeNull();
    expect(hostnameOfHostHeader("[::1")).toBeNull();
  });

  it("accepts loopback and LAN hosts and rejects a rebinding name", () => {
    expect(isAllowedHostHeader("127.0.0.1:3000")).toBe(true);
    expect(isAllowedHostHeader("192.168.1.20:5173")).toBe(true);
    expect(isAllowedHostHeader("attacker.example.com:3000")).toBe(false);
    expect(isAllowedHostHeader(undefined)).toBe(true);
  });
});

describe("origin-guard Origin header", () => {
  it("allows a missing Origin (non-browser client) and local pages", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.20:5173")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:5173")).toBe(true);
  });

  it("rejects a foreign site, the opaque null origin and garbage", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin("not a url")).toBe(false);
  });

  it("accepts a listed extra host", () => {
    expect(isAllowedOrigin("http://demo-laptop.local:5173", ["demo-laptop.local"])).toBe(true);
  });
});
