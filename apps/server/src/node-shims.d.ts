// This workspace has no @types/node; declare only the Node pieces the offline CLI uses.
declare module "node:fs" {
  export function writeFileSync(path: string, data: string): void;
}
declare const process: { argv: string[]; stdout: { write(s: string): void } };
declare function setInterval(handler: () => void, ms: number): unknown;
declare function setTimeout(handler: (...args: never[]) => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;
declare const performance: { now(): number };
declare module "ws" {
  export class WebSocket {
    constructor(url: string);
    readyState: number;
    send(data: string): void;
    close(): void;
    on(event: "message", cb: (data: { toString(): string }) => void): void;
    on(event: "close", cb: () => void): void;
    on(event: "open", cb: () => void): void;
    on(event: "error", cb: (e: unknown) => void): void;
  }
  export class WebSocketServer {
    constructor(options: { port: number; host?: string });
    on(event: "connection", cb: (socket: WebSocket) => void): void;
    on(event: "listening", cb: () => void): void;
    close(cb?: () => void): void;
    address(): { port: number } | string | null;
  }
}
