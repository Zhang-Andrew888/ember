// This workspace has no @types/node; declare only the Node pieces the server uses.
declare module "node:fs" {
  export function writeFileSync(path: string, data: string): void;
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "node:crypto" {
  export function randomBytes(size: number): { toString(encoding: "hex"): string };
}
declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
declare module "node:worker_threads" {
  export class Worker {
    constructor(filename: URL | string);
    postMessage(value: unknown): void;
    on(event: "message", listener: (value: unknown) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    on(event: "exit", listener: (code: number) => void): void;
    terminate(): Promise<number>;
    unref(): void;
  }
}
declare module "node:http" {
  export interface IncomingMessage {
    url?: string;
    headers: Record<string, string | string[] | undefined>;
  }
  export interface Server {
    on(event: "upgrade", cb: (request: IncomingMessage, socket: unknown, head: Uint8Array) => void): void;
    address(): { port: number } | string | null;
  }
}
declare const Buffer: {
  from(data: unknown, encoding?: string): Uint8Array & { toString(encoding?: string): string };
};
declare const process: {
  argv: string[];
  exitCode?: number;
  env: Record<string, string | undefined>;
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
  on(event: "SIGINT" | "SIGTERM", cb: () => void): void;
  exit(code?: number): never;
};
declare const console: { log(message?: string): void };
declare class Blob {
  constructor(parts: unknown[], options?: { type?: string });
}
declare class FormData {
  append(name: string, value: Blob, filename?: string): void;
}
declare function setInterval(handler: () => void, ms: number): unknown;
declare function setTimeout(handler: (...args: never[]) => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;
declare function clearTimeout(handle: unknown): void;
declare module "node:net" {
  export interface Socket {
    write(data: string): void;
    destroy(): void;
    on(event: "data", cb: (chunk: { toString(): string }) => void): void;
    on(event: "close", cb: () => void): void;
    on(event: "error", cb: (err: unknown) => void): void;
  }
  export function connect(port: number, host: string, listener?: () => void): Socket;
}
declare const performance: { now(): number };
declare const fetch: (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | FormData },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
declare class URLSearchParams {
  constructor(init?: string);
  get(name: string): string | null;
}
interface ImportMeta {
  url: string;
}
declare module "ws" {
  export class WebSocket {
    constructor(url: string);
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    /** Destroy the socket immediately. `close()` alone waits for a handshake. */
    terminate(): void;
    on(event: "message", cb: (data: { toString(): string }) => void): void;
    on(event: "close", cb: (code: number) => void): void;
    on(event: "open", cb: () => void): void;
    on(event: "error", cb: (e: unknown) => void): void;
  }
  export class WebSocketServer {
    constructor(options: { port?: number; host?: string; maxPayload?: number; noServer?: boolean });
    on(event: "connection", cb: (socket: WebSocket) => void): void;
    on(event: "listening", cb: () => void): void;
    handleUpgrade(
      request: unknown,
      socket: unknown,
      head: Uint8Array,
      cb: (ws: WebSocket) => void,
    ): void;
    close(cb?: () => void): void;
    address(): { port: number } | string | null;
  }
}
