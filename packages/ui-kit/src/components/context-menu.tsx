import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuSub = ContextMenuPrimitive.Sub;
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

function ContextMenuContent({ className, ...props }: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn("z-[100] min-w-[172px] rounded-xl border border-[#272725] bg-white p-1.5 text-[#40403c] shadow-[0_10px_24px_rgba(0,0,0,0.12)] outline-none dark:border-border dark:bg-card dark:text-foreground", className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({ className, ...props }: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>) {
  return <ContextMenuPrimitive.Item className={cn("flex h-8 cursor-default select-none items-center gap-2 rounded-[7px] px-2.5 text-[12px] outline-none transition-colors focus:bg-[#f0f0ec] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-muted", className)} {...props} />;
}

function ContextMenuSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn("my-1 h-px bg-[#e8e8e3] dark:bg-border", className)} {...props} />;
}

function ContextMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>) {
  return <ContextMenuPrimitive.Label className={cn("px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#8d8d86] dark:text-muted-foreground", className)} {...props} />;
}

function ContextMenuSubTrigger({ className, children, ...props }: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger className={cn("flex h-8 cursor-default select-none items-center gap-2 rounded-[7px] px-2.5 text-[12px] outline-none transition-colors focus:bg-[#f0f0ec] data-[state=open]:bg-[#f0f0ec] dark:focus:bg-muted dark:data-[state=open]:bg-muted", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto h-3.5 w-3.5 text-[#8d8d86] dark:text-muted-foreground" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

function ContextMenuSubContent({ className, ...props }: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>) {
  return <ContextMenuPrimitive.SubContent className={cn("z-[100] max-h-[min(430px,60vh)] min-w-[172px] overflow-y-auto rounded-xl border border-[#272725] bg-white p-1.5 text-[#40403c] shadow-[0_10px_24px_rgba(0,0,0,0.12)] outline-none dark:border-border dark:bg-card dark:text-foreground", className)} {...props} />;
}

function ContextMenuRadioItem({ className, children, ...props }: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem className={cn("flex h-8 cursor-default select-none items-center gap-2 rounded-[7px] py-0 pl-2.5 pr-7 text-[12px] outline-none transition-colors focus:bg-[#f0f0ec] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-muted", className)} {...props}>
      {children}
      <ContextMenuPrimitive.ItemIndicator className="absolute right-2.5 grid place-items-center">
        <Check className="h-3.5 w-3.5 text-[#5e7a3c] dark:text-[#b6d47f]" />
      </ContextMenuPrimitive.ItemIndicator>
    </ContextMenuPrimitive.RadioItem>
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
