"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type ToastRegionProps = {
  message: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionLabel?: string;
  onAction?: () => void;
};

export function ToastRegion({ message, open, onOpenChange, actionLabel, onAction }: ToastRegionProps) {
  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={actionLabel ? 12000 : 4500}>
      <ToastPrimitive.Root className="ui-toast" open={open} onOpenChange={onOpenChange}>
        <ToastPrimitive.Description>{message}</ToastPrimitive.Description>
        {actionLabel && onAction && <ToastPrimitive.Action asChild altText={actionLabel}><Button variant="soft" size="sm" type="button" onClick={onAction}>{actionLabel}</Button></ToastPrimitive.Action>}
        <ToastPrimitive.Close className="ui-toast-close" aria-label="关闭提示"><X size={15} /></ToastPrimitive.Close>
      </ToastPrimitive.Root>
      <ToastPrimitive.Viewport className="ui-toast-viewport" />
    </ToastPrimitive.Provider>
  );
}
