"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminApi,
  type ChatConversation,
  type ChatConversationDetail,
} from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConversationReplyDialog } from "@/components/admin/ConversationReplyDialog";
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

/** Message laissé à l'équipe et pas encore traité. */
const needsAction = (c: ChatConversation) =>
  c.contactLeftAt !== null && c.contactProcessedAt === null;

export default function ConversationsPage() {
  const [rows, setRows] = useState<ChatConversation[] | null>(null);
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState<ChatConversationDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [processedBusy, setProcessedBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatConversation | null>(null);

  const reload = useCallback(() => {
    adminApi
      .listConversations()
      .then(setRows)
      .catch(() => setError(true));
  }, []);
  useEffect(() => reload(), [reload]);

  const openDetail = async (id: string) => {
    try {
      setDetail(await adminApi.conversationDetail(id));
      setDetailOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const setProcessed = async (conv: ChatConversation, processed: boolean) => {
    if (processedBusy) return;
    setProcessedBusy(true);
    try {
      await adminApi.setConversationProcessed(conv.id, processed);
      toast.success(processed ? "Message marqué comme traité." : "Message repassé à traiter.");
      reload();
      // Reflète le changement dans le modal s'il est ouvert sur cette conversation.
      setDetail((d) =>
        d && d.conversation.id === conv.id
          ? {
              ...d,
              conversation: {
                ...d.conversation,
                contactProcessedAt: processed ? new Date().toISOString() : null,
              },
            }
          : d,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setProcessedBusy(false);
    }
  };

  if (error)
    return <p className="text-sm text-destructive">Impossible de charger les conversations.</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const todo = rows.filter(needsAction);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
          <p className="text-sm text-muted-foreground">
            Échanges des visiteurs avec l&apos;assistant IA du site
          </p>
        </div>
        {todo.length > 0 && (
          <Badge variant="warning" className="px-3 py-1 text-sm">
            {todo.length} message{todo.length > 1 ? "s" : ""} à traiter
          </Badge>
        )}
      </div>

      <HelpCard id="conversations">
        <p>
          Chaque ligne est une conversation avec l&apos;assistant « Léa » sur le site public.
          Quand un visiteur laisse un message à l&apos;équipe, la conversation passe en tête de
          liste avec le badge <b>À traiter</b> jusqu&apos;à ce que vous la marquiez traitée
          (après avoir répondu au visiteur par e-mail). Relisez aussi les transcripts pour
          repérer les questions qui reviennent — c&apos;est la meilleure source pour enrichir
          les connaissances de Léa (Réglages → Assistant IA).
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
              <TableHead>Statut</TableHead>
              <TableHead className="text-center">Messages</TableHead>
              <TableHead>Langue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => {
              const urgent = needsAction(c);
              return (
                <TableRow
                  key={c.id}
                  className={
                    "cursor-pointer " + (urgent ? "bg-amber-50 hover:bg-amber-100/70" : "")
                  }
                  onClick={() => openDetail(c.id)}
                >
                  <TableCell className="whitespace-nowrap">
                    {dateFmt.format(new Date(c.updatedAt))}
                  </TableCell>
                  <TableCell className="max-w-[320px] text-muted-foreground">
                    {excerpt(c.lastMessage)}
                  </TableCell>
                  <TableCell>
                    {c.visitorName || c.visitorEmail ? (
                      <div className="space-y-0.5">
                        <div className={urgent ? "font-medium" : ""}>{c.visitorName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{c.visitorEmail}</div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Anonyme</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {urgent ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="warning">À traiter</Badge>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={processedBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            setProcessed(c, true);
                          }}
                        >
                          Traité
                        </Button>
                      </div>
                    ) : c.contactLeftAt ? (
                      <Badge variant="success">Traité</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{c.messageCount}</TableCell>
                  <TableCell className="uppercase text-muted-foreground">{c.locale}</TableCell>
                </TableRow>
              );
            })}
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
        footer={
          detail?.conversation.contactLeftAt ? (
            needsAction(detail.conversation) ? (
              <div className="flex gap-2">
                {detail.conversation.visitorEmail && (
                  <Button onClick={() => setReplyTo(detail.conversation)}>
                    Répondre par e-mail
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={processedBusy}
                  onClick={() => setProcessed(detail.conversation, true)}
                >
                  Marquer comme traité
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                disabled={processedBusy}
                onClick={() => setProcessed(detail.conversation, false)}
              >
                Repasser à traiter
              </Button>
            )
          ) : undefined
        }
        wide
      >
        <ConversationTranscript detail={detail} />
      </Modal>

      {replyTo && (
        <ConversationReplyDialog
          conversation={replyTo}
          onClose={() => setReplyTo(null)}
          onSent={() => {
            setReplyTo(null);
            setDetailOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
