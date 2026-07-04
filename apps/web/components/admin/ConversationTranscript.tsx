"use client";

import type { ChatConversationDetail } from "@/lib/admin-api";

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Transcript d'une conversation chatbot (page Conversations + fiche contact). */
export function ConversationTranscript({
  detail,
}: {
  detail: ChatConversationDetail | null;
}) {
  if (!detail) return null;
  return (
    <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
      {detail.messages.map((m, i) => (
        <div
          key={i}
          className={
            m.role === "user"
              ? "ml-10 rounded-lg bg-primary/10 px-3 py-2 text-sm"
              : m.role === "contact"
                ? "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                : "mr-10 rounded-lg bg-muted px-3 py-2 text-sm"
          }
        >
          <div className="mb-0.5 text-xs font-medium text-muted-foreground">
            {m.role === "user"
              ? "Visiteur"
              : m.role === "contact"
                ? "Message laissé via le formulaire"
                : "Léa"}
            {" · "}
            {dateFmt.format(new Date(m.createdAt))}
          </div>
          <div className="whitespace-pre-wrap">{m.content}</div>
        </div>
      ))}
    </div>
  );
}
