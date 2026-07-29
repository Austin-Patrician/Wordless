import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

type DialogContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  showCloseButton?: boolean;
};

function DialogContent({ className, children, overlayClassName, showCloseButton = true, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-foreground/35 backdrop-blur-[2px]", overlayClassName)} />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[60] max-h-[calc(100vh-2rem)] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? <DialogPrimitive.Close asChild>
          <Button className="absolute right-4 top-4" size="icon" variant="ghost" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </Button>
        </DialogPrimitive.Close> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger };
