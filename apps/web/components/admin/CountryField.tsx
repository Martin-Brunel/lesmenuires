"use client";

// Champ pays : autocomplete natif (datalist) sur les noms français,
// valeur stockée = code ISO 3166-1 alpha-2.

import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { COUNTRIES, countryCode, countryName } from "@/lib/countries";

export function CountryField({
  value,
  onChange,
  placeholder = "France",
}: {
  /** Code ISO ("FR") — "" si non renseigné. */
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const [text, setText] = useState(countryName(value));

  useEffect(() => {
    setText(countryName(value));
  }, [value]);

  return (
    <>
      <Input
        list={listId}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const code = countryCode(v);
          if (code) onChange(code);
          else if (!v.trim()) onChange("");
        }}
        onBlur={() => {
          const code = countryCode(text);
          if (code) {
            onChange(code);
            setText(countryName(code));
          } else if (!text.trim()) {
            onChange("");
          } else {
            // Saisie non reconnue : on revient au dernier pays valide.
            setText(countryName(value));
          }
        }}
      />
      <datalist id={listId}>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.name} />
        ))}
      </datalist>
    </>
  );
}
