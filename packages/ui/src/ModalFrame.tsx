import { useRef, type FormEventHandler, type ReactNode, type RefObject } from "react";
import { useDialogFocus } from "./useDialogFocus";

export interface ModalFrameProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className: string;
  overlayClassName?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  role?: "dialog" | "alertdialog";
  as?: "div" | "form";
  onSubmit?: FormEventHandler<HTMLFormElement>;
}

/** Headless modal shell for product-specific dialog layouts. */
export function ModalFrame({ open, onClose, children, className, overlayClassName = "dialog-backdrop", ariaLabel, ariaLabelledBy, ariaDescribedBy, initialFocusRef, closeOnBackdrop = true, role = "dialog", as = "div", onSubmit }: ModalFrameProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(open, dialogRef, onClose, initialFocusRef);
  if (!open) return null;
  return <div className={overlayClassName} role="presentation" onMouseDown={() => { if (closeOnBackdrop) onClose(); }}>
    {as === "form"
      ? <form ref={(node) => { dialogRef.current = node; }} tabIndex={-1} className={className} role={role} aria-modal="true" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} onMouseDown={(event) => event.stopPropagation()} onSubmit={onSubmit}>{children}</form>
      : <div ref={(node) => { dialogRef.current = node; }} tabIndex={-1} className={className} role={role} aria-modal="true" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} onMouseDown={(event) => event.stopPropagation()}>{children}</div>}
  </div>;
}
