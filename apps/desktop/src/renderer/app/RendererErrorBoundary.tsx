import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import errorMascot from "../../icons/common-icons/main-loading-error.svg";

type RendererErrorBoundaryProps = {
  children: ReactNode;
};

type RendererErrorBoundaryState = {
  error: Error | null;
};

function isChineseLocale(): boolean {
  if (typeof document === "undefined") return true;
  const lang = document.documentElement.lang;
  return lang !== "en" && lang !== "en-US";
}

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
    const chinese = isChineseLocale();
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f7f4] px-6 py-10 text-[#34352f] dark:bg-[#171814] dark:text-foreground">
        <section className="flex w-full max-w-[360px] flex-col items-center text-center">
          <img
            alt=""
            className="h-[220px] w-[220px] object-contain drop-shadow-[0_18px_28px_rgba(40,42,32,0.12)]"
            draggable={false}
            src={errorMascot}
          />
          <h1 className="mt-1 flex items-center gap-2 text-[16px] font-semibold tracking-wide">
            {chinese ? "oou,似乎出现了点问题" : "Sorry, something went wrong"}
            <span aria-hidden="true" className="mt-0.5 inline-flex items-center gap-[3px]">
              <span className="h-1 w-1 animate-pulse rounded-full bg-current opacity-70" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-current opacity-70 [animation-delay:160ms]" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-current opacity-70 [animation-delay:320ms]" />
            </span>
          </h1>
          <p className="mt-2 max-w-[280px] text-[12px] leading-5 text-[#777870] dark:text-muted-foreground">
            {chinese
              ? "当前界面无法渲染。会话数据仍保存在本地。"
              : "The current view could not be rendered. Your session data is still saved."}
          </p>
          <button
            className="mt-6 inline-flex h-9 items-center gap-2 rounded-[8px] bg-[#292a27] px-4 text-[12px] font-semibold text-white shadow-[0_1px_2px_rgba(20,22,16,0.18)] transition-[background-color,transform] hover:bg-[#3a3b37] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9caf64]/70 dark:bg-[#e7eadf] dark:text-[#1f211c] dark:hover:bg-white"
            onClick={() => window.location.reload()}
            type="button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload Wordless
          </button>
          <details className="mt-6 w-full text-left text-[10px] text-[#92938b] dark:text-muted-foreground">
            <summary className="cursor-pointer select-none text-center hover:text-[#5f6058] dark:hover:text-foreground">
              {chinese ? "错误详情" : "Error details"}
            </summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-[#ecece6] px-3 py-2 font-mono leading-4 dark:bg-[#22231f]">
              {this.state.error.message}
            </pre>
          </details>
        </section>
      </main>
    );
  }
}
