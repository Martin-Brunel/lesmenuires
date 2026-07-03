"use client";

import { Input } from "@/components/ui/input";

// Native date input. Value in/out is an ISO date (YYYY-MM-DD) — the browser
// renders it in the user's locale (JJ/MM/AAAA on a French browser) and
// provides the platform date picker.

export function DateField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
}) {
  return (
    <Input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  );
}
