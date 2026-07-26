import type { ReactNode } from "react";

type ThreadContentFrameProps = {
  children: ReactNode;
  className?: string;
  densityRail?: boolean;
};

export function ThreadContentFrame({ children, className = "", densityRail = false }: ThreadContentFrameProps) {
  const gutters = densityRail
    ? "pl-[58px] pr-5 sm:pl-[70px] sm:pr-8"
    : "px-5 sm:px-8";

  return <div className={`mx-auto w-full max-w-[820px] ${gutters} ${className}`}>{children}</div>;
}
