// Avatar « à la Gmail » : initiales sur fond coloré, couleur stable dérivée
// du nom (même personne = même couleur partout).

const PALETTE = [
  "#0b57d0", // bleu
  "#146c2e", // vert
  "#8e24aa", // violet
  "#c5221f", // rouge
  "#b06000", // ocre
  "#00639b", // cyan foncé
  "#7a1fa2", // pourpre
  "#356a1a", // olive
  "#a50e0e", // brique
  "#00696d", // sarcelle
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarColor(key: string): string {
  return PALETTE[hashString(key) % PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({
  name,
  size = 28,
  title,
}: {
  /** Nom affiché (ou e-mail) — sert aux initiales ET à la couleur. */
  name: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title ?? name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        backgroundColor: avatarColor(name),
      }}
    >
      {initials(name)}
    </span>
  );
}
