"use client";

import { useState } from "react";
import { adminApi, type ChatConversation } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";

/** Réponse e-mail directe au visiteur d'une conversation chat. L'envoi marque
 *  automatiquement la conversation comme traitée (côté API). */
export function ConversationReplyDialog({
  conversation,
  onClose,
  onSent,
}: {
  conversation: ChatConversation;
  onClose: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("Réponse à votre message");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy || !subject.trim() || !message.trim()) return;
    setBusy(true);
    try {
      await adminApi.replyConversation(conversation.id, subject.trim(), message.trim());
      toast.success(`Réponse envoyée à ${conversation.visitorEmail} — message marqué traité.`);
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Répondre à ${conversation.visitorName ?? conversation.visitorEmail}`}
      description={`E-mail envoyé à ${conversation.visitorEmail} avec l'habillage du site. L'envoi marque le message comme traité.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={send} disabled={busy || !subject.trim() || !message.trim()}>
            {busy ? "Envoi…" : "Envoyer la réponse"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="reply-subject">Sujet</Label>
          <Input
            id="reply-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reply-message">Message</Label>
          <textarea
            id="reply-message"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            rows={7}
            placeholder="Bonjour, merci pour votre message…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            autoFocus
          />
        </div>
      </div>
    </Modal>
  );
}
