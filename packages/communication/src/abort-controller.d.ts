// Node 22 provides AbortController. This package has no @types/node, and Rollup's empty
// AbortSignal interface merges with this declaration.
declare class AbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
  static timeout(milliseconds: number): AbortSignal;
  static any(signals: readonly AbortSignal[]): AbortSignal;
}

declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
