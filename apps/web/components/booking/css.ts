import type { CSSProperties } from "react";

/**
 * Parse an inline CSS declaration string into a React style object.
 *
 * This lets us port the design prototype's `style="..."` strings almost
 * verbatim (keeping the exact pixel values from the maquette) instead of
 * hand-converting every declaration to camelCase.
 *
 *   css("font:400 42px 'Marcellus';color:#1A1B1A")
 *   // => { font: "400 42px 'Marcellus'", color: "#1A1B1A" }
 */
export function css(decls: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of decls.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    if (!prop) continue;
    const value = decl.slice(idx + 1).trim();
    // background:#E5E4DF url('https://…') keeps its `https:` — only the first
    // colon separates property from value.
    const key = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }
  return out as CSSProperties;
}
