"use client";

import type { RefObject } from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function ConfirmDialog({ open, title, description, confirmLabel, danger = false, onConfirm, onOpenChange, returnFocusRef }: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="ui-sheet-overlay" />
        <AlertDialogPrimitive.Content className="ui-confirm-content" onCloseAutoFocus={(event) => { if (returnFocusRef?.current) { event.preventDefault(); returnFocusRef.current.focus(); } }}>
          <AlertDialogPrimitive.Title>{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description>{description}</AlertDialogPrimitive.Description>
          <div className="ui-confirm-actions">
            <AlertDialogPrimitive.Cancel asChild><Button variant="outline" type="button">取消</Button></AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild><Button className={danger ? "danger-button" : ""} variant={danger ? "outline" : "default"} type="button" onClick={onConfirm}>{confirmLabel}</Button></AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
