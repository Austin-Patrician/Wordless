import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

function DropdownMenuContent({ className, ...props }: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn("z-[100] min-w-[172px] rounded-xl border border-[#272725] bg-white p-1.5 text-[#40403c] shadow-[0_10px_24px_rgba(0,0,0,0.12)] outline-none dark:border-border dark:bg-card dark:text-foreground", className)}
        sideOffset={6}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={cn("flex h-8 cursor-default select-none items-center gap-2 rounded-[7px] px-2.5 text-[12px] outline-none transition-colors focus:bg-[#f0f0ec] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-muted", className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("my-1 h-px bg-[#e8e8e3] dark:bg-border", className)} {...props} />;
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger };
