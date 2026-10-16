import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * 浮层层级(唯一的说明在这里,其他地方按这张表排):
 *
 * ```
 *   50   dialog 遮罩
 *   60   dialog 内容
 *   100  context-menu / dropdown-menu / hover-card
 *   110  popover
 *   120  tooltip      ← 最高
 * ```
 *
 * tooltip 必须**高于所有浮层**,因为它标注的控件常常就住在那些浮层里(弹层里的图标按钮、
 * popover 里的图标按钮)。曾经它是 `z-50`,比 dialog 内容的 `z-[60]` 还低 —— 于是弹层里的
 * tooltip 被弹层盖住,用户只看到"有一部分没盖住"(露在弹层外面的那一角)。
 * 这条顺序由 `apps/desktop/test/overlay-layers.test.ts` 守着。
 */
function TooltipContent({ className, sideOffset = 6, ...props }: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className={cn("z-[120] rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md", className)}
        sideOffset={sideOffset}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
