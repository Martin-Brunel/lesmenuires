/** Scoped typography for legal/prose pages (brand fonts, readable rhythm). */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="prose-legal">
      <style>{`
        .prose-legal h1 { font: 400 34px/1.2 'Marcellus', serif; margin: 0 0 8px; }
        .prose-legal .updated { font: 400 13px 'Hanken Grotesk'; color: #9A9C97; margin: 0 0 28px; }
        .prose-legal h2 { font: 500 18px 'Hanken Grotesk'; margin: 30px 0 10px; color: #1A1B1A; }
        .prose-legal p, .prose-legal li { font: 400 15px/1.7 'Hanken Grotesk'; color: #4a4c48; }
        .prose-legal p { margin: 0 0 12px; }
        .prose-legal ul { margin: 0 0 12px; padding-left: 20px; }
        .prose-legal li { margin: 0 0 6px; }
        .prose-legal a { color: #4E6E8C; }
        .prose-legal strong { color: #1A1B1A; }
        .prose-legal .note { background:#fff; border:1px solid #ececec; border-radius:12px; padding:14px 16px; margin:0 0 12px; }
      `}</style>
      {children}
    </div>
  );
}
