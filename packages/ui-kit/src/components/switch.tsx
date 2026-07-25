import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-[#b8bbb1] bg-[#cdd0c6] shadow-xs transition-colors data-[state=checked]:border-[#252624] data-[state=checked]:bg-[#252624] data-[state=unchecked]:border-[#b8bbb1] data-[state=unchecked]:bg-[#cdd0c6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#62665a] dark:bg-[#55594e] dark:data-[state=checked]:border-[#c4eb58] dark:data-[state=checked]:bg-[#c4eb58] dark:data-[state=unchecked]:border-[#62665a] dark:data-[state=unchecked]:bg-[#55594e]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-md ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:bg-[#181912]" />
    </SwitchPrimitive.Root>
  );
}
