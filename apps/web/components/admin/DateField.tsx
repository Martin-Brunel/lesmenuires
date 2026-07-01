"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

// Date field that ALWAYS displays/accepts JJ/MM/AAAA (French), regardless of the
// browser locale, and emits an ISO date (YYYY-MM-DD). Native <input type="date">
// can't be reformatted, hence this custom masked text field.

function isoToFr(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : "";
}

function frToIso(fr: string) {
  const m = fr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso + "T12:00:00");
  if (Number.isNaN(dt.getTime())) return "";
  // Reject impossible dates (e.g. 31/02/2026).
  if (dt.getDate() !== Number(d) || dt.getMonth() + 1 !== Number(mo)) return "";
  return iso;
}

export function DateField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
}) {
  const [text, setText] = useState(isoToFr(value));

  // Sync from the outside only on genuine external changes (e.g. form reset),
  // never while the user is mid-typing an incomplete date.
  useEffect(() => {
    if (frToIso(text) !== value) setText(isoToFr(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(out);
    onChange(frToIso(out));
  };

  return (
    <Input
      value={text}
      onChange={(e) => handle(e.target.value)}
      placeholder="JJ/MM/AAAA"
      inputMode="numeric"
      className={className}
    />
  );
}
