import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

const HoverCard = HoverCardPrimitive.Root;
const HoverCardTrigger = HoverCardPrimitive.Trigger;

function HoverCardContent({ className, sideOffset = 8, ...props }: ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        className={cn("z-[100] rounded-[8px] border border-[#deded9] bg-white text-[#3e3e39] shadow-[0_12px_28px_rgba(0,0,0,0.12)] outline-none dark:border-border dark:bg-card dark:text-foreground", className)}
        sideOffset={sideOffset}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
