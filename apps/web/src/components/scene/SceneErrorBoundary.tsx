import { Component, type ReactNode } from "react";

interface SceneErrorBoundaryProps {
  readonly onError: () => void;
  readonly children: ReactNode;
}

/** Keeps a rendering failure inside the map region so the rest of the page stays usable. */
export class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
