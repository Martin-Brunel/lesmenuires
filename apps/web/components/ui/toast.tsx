"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ToastItem = { id: number; message: string; variant: "success" | "error" };

let items: ToastItem[] = [];
let listeners: ((t: ToastItem[]) => void)[] = [];
let seq = 1;

function emit() {
  for (const l of listeners) l(items);
}

function push(message: string, variant: "success" | "error") {
  const id = seq++;
  items = [...items, { id, message, variant }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 4200);
}

export const toast = {
  success: (m: string) => push(m, "success"),
  error: (m: string) => push(m, "error"),
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    const l = (t: ToastItem[]) => setList([...t]);
    listeners.push(l);
    setList([...items]);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "min-w-[220px] max-w-sm rounded-md border px-4 py-3 text-sm shadow-lg",
            t.variant === "error"
              ? "border-destructive bg-destructive text-white"
              : "border-border bg-background text-foreground",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
