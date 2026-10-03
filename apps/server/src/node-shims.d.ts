// This workspace has no @types/node; declare only the Node pieces the offline CLI uses.
declare module "node:fs" {
  export function writeFileSync(path: string, data: string): void;
}
declare const process: { argv: string[]; stdout: { write(s: string): void } };
