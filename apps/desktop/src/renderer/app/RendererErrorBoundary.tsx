import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

type RendererErrorBoundaryProps = {
  children: ReactNode;
};

type RendererErrorBoundaryState = {
  error: Error | null;
};

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Wordless renderer failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f7f4] p-6 text-[#34352f] dark:bg-[#171814] dark:text-foreground">
        <section className="w-full max-w-[420px] border-l-2 border-[#b56852] pl-5">
          <TriangleAlert className="mb-4 h-5 w-5 text-[#b56852]" />
          <h1 className="text-[15px] font-semibold">Wordless display error</h1>
          <p className="mt-2 text-[12px] leading-5 text-[#777870] dark:text-muted-foreground">
            The current view could not be rendered. Your session data is still
            saved.
          </p>
          <button
            className="mt-5 inline-flex h-8 items-center gap-2 border border-[#d7d8d1] bg-white px-3 text-[11px] font-medium transition-colors hover:bg-[#f0f1eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-border dark:bg-card dark:hover:bg-muted"
            onClick={() => window.location.reload()}
            type="button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload Wordless
          </button>
          <details className="mt-5 text-[10px] text-[#92938b] dark:text-muted-foreground">
            <summary className="cursor-pointer select-none">Error details</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono leading-4">
              {this.state.error.message}
            </pre>
          </details>
        </section>
      </main>
    );
  }
}
