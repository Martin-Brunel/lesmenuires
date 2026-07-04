"use client";

import { useEffect, useState } from "react";
import {
  adminApi,
  type ChatConversation,
  type ChatConversationDetail,
} from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConversationTranscript } from "@/components/admin/ConversationTranscript";
import { HelpCard } from "@/components/admin/HelpCard";

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function excerpt(s: string, max = 90) {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export default function ConversationsPage() {
  const [rows, setRows] = useState<ChatConversation[] | null>(null);
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState<ChatConversationDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    adminApi
      .listConversations()
      .then(setRows)
      .catch(() => setError(true));
  }, []);

  const openDetail = async (id: string) => {
    try {
      setDetail(await adminApi.conversationDetail(id));
      setDetailOpen(true);
    } catch {
      /* toast non monté ici : silencieux, la ligne reste cliquable */
    }
  };

  if (error)
    return <p className="text-sm text-destructive">Impossible de charger les conversations.</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
        <p className="text-sm text-muted-foreground">
          Échanges des visiteurs avec l&apos;assistant IA du site
        </p>
      </div>

      <HelpCard id="conversations">
        <p>
          Chaque ligne est une conversation avec l&apos;assistant « Léa » sur le site public.
          Le badge <b>Message laissé</b> signale qu&apos;un visiteur a utilisé le formulaire de
          contact : vous avez reçu un e-mail et ses coordonnées sont dans la colonne Visiteur.
          Relisez les transcripts pour repérer les questions qui reviennent — c&apos;est la
          meilleure source pour enrichir le contenu éditorial.
        </p>
      </HelpCard>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Aucune conversation pour le moment.
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dernière activité</TableHead>
              <TableHead>Dernier message</TableHead>
              <TableHead>Visiteur</TableHead>
              <TableHead className="text-center">Messages</TableHead>
              <TableHead>Langue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => openDetail(c.id)}
              >
                <TableCell className="whitespace-nowrap">
                  {dateFmt.format(new Date(c.updatedAt))}
                </TableCell>
                <TableCell className="max-w-[340px] text-muted-foreground">
                  {excerpt(c.lastMessage)}
                </TableCell>
                <TableCell>
                  {c.visitorName || c.visitorEmail ? (
                    <div className="space-y-0.5">
                      <div>{c.visitorName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{c.visitorEmail}</div>
                      {c.contactLeftAt && <Badge variant="secondary">Message laissé</Badge>}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Anonyme</span>
                  )}
                </TableCell>
                <TableCell className="text-center">{c.messageCount}</TableCell>
                <TableCell className="uppercase text-muted-foreground">{c.locale}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={
          detail?.conversation.visitorName
            ? `Conversation — ${detail.conversation.visitorName}`
            : "Conversation"
        }
        description={
          detail
            ? `${dateFmt.format(new Date(detail.conversation.createdAt))} · ${detail.conversation.messageCount} messages${detail.conversation.visitorEmail ? ` · ${detail.conversation.visitorEmail}` : ""}`
            : undefined
        }
        wide
      >
        <ConversationTranscript detail={detail} />
      </Modal>
    </div>
  );
}
