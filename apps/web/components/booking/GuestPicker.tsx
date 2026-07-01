"use client";

// Compact guest-count selector (adults / children) shared by both funnels.
// Inline-styled to match the editorial funnel look.

import { css } from "./css";

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const btn = (enabled: boolean) =>
    css(
      `width:34px;height:34px;border-radius:9px;border:1px solid rgba(0,0,0,.14);background:#FFF;font:600 18px 'Hanken Grotesk';display:flex;align-items:center;justify-content:center;${
        enabled ? "cursor:pointer;color:#1A1B1A;" : "cursor:default;color:#C9C8C3;"
      }`,
    );
  return (
    <div style={css("display:flex;align-items:center;justify-content:space-between;gap:12px")}>
      <div>
        <div style={css("font:600 14px 'Hanken Grotesk';color:#1A1B1A")}>{label}</div>
        <div style={css("font:400 12px 'Hanken Grotesk';color:#8A8C87")}>{hint}</div>
      </div>
      <div style={css("display:flex;align-items:center;gap:12px")}>
        <div
          role="button"
          aria-label={`Retirer ${label}`}
          onClick={() => value > min && onChange(value - 1)}
          style={btn(value > min)}
        >
          −
        </div>
        <div style={css("min-width:20px;text-align:center;font:600 15px 'Hanken Grotesk'")}>{value}</div>
        <div
          role="button"
          aria-label={`Ajouter ${label}`}
          onClick={() => value < max && onChange(value + 1)}
          style={btn(value < max)}
        >
          +
        </div>
      </div>
    </div>
  );
}

export function GuestPicker({
  adults,
  children,
  capacity,
  setAdults,
  setChildren,
}: {
  adults: number;
  children: number;
  capacity: number;
  setAdults: (n: number) => void;
  setChildren: (n: number) => void;
}) {
  return (
    <div style={css("display:flex;flex-direction:column;gap:14px;padding:14px;border:1px solid rgba(0,0,0,.1);border-radius:12px;background:#FFF")}>
      <Stepper
        label="Adultes"
        hint={`Jusqu'à ${capacity} voyageurs`}
        value={adults}
        min={1}
        max={capacity}
        onChange={setAdults}
      />
      <Stepper
        label="Enfants"
        hint="Moins de 12 ans"
        value={children}
        min={0}
        max={capacity}
        onChange={setChildren}
      />
    </div>
  );
}
