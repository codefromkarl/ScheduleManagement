"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string; description?: string; returnFocusRef?: React.RefObject<HTMLElement | null> }
>(({ className, children, title, description, returnFocusRef, onCloseAutoFocus, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-sheet-overlay" />
    <DialogPrimitive.Content ref={ref} className={cn("ui-sheet-content", className)} onCloseAutoFocus={(event) => { onCloseAutoFocus?.(event); if (!event.defaultPrevented && returnFocusRef?.current) { event.preventDefault(); returnFocusRef.current.focus(); } }} {...props}>
      <header className="ui-sheet-header">
        <div>
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          {description && <DialogPrimitive.Description>{description}</DialogPrimitive.Description>}
        </div>
        <DialogPrimitive.Close className="ui-sheet-close" aria-label="关闭">
          <X size={18} />
        </DialogPrimitive.Close>
      </header>
      <div className="ui-sheet-body">{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

export { Sheet, SheetClose, SheetContent, SheetTrigger };
