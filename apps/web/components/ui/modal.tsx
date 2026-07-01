"use client";

import type { ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className="text-base font-semibold">{title}</h2>}
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground whitespace-pre-line">{description}</p>
        )}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
