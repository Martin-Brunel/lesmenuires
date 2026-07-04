"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import { ApiError, sendChatContact, sendChatMessage } from "@/lib/api";
import { site } from "@/lib/site";

const STORAGE_KEY = "adret-chat";
const STORED_MESSAGES_CAP = 50;
const FONT = "'Hanken Grotesk', system-ui, sans-serif";
const ACCENT = "#4E6E8C";
const INK = "#1A1B1A";

type ChatMsg = {
  role: "user" | "assistant" | "info";
  text: string;
};

type Stored = { sessionToken?: string; messages: ChatMsg[] };

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Stored;
  } catch {
    /* mode privé / JSON corrompu : repartir de zéro */
  }
  return { messages: [] };
}

function saveStored(s: Stored) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...s, messages: s.messages.slice(-STORED_MESSAGES_CAP) }),
    );
  } catch {
    /* ignore */
  }
}

/** Rythme « humain » : la réponse ne tombe jamais instantanément. */
function humanDelay(startedAt: number, replyLength: number) {
  const target = Math.min(800 + replyLength * 12, 2500);
  return Math.max(0, target - (Date.now() - startedAt));
}

export function ChatWidget() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [contactMode, setContactMode] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [contactError, setContactError] = useState(false);
  const [contactSending, setContactSending] = useState(false);
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cMessage, setCMessage] = useState("");
  const tokenRef = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = loadStored();
    tokenRef.current = stored.sessionToken;
    if (stored.messages.length) setMessages(stored.messages);
  }, []);

  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("adret:open-chat", openIt);
    return () => window.removeEventListener("adret:open-chat", openIt);
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, typing, open, contactMode]);

  useEffect(() => {
    if (open && !contactMode) inputRef.current?.focus();
  }, [open, contactMode]);

  const persist = useCallback((msgs: ChatMsg[]) => {
    saveStored({ sessionToken: tokenRef.current, messages: msgs });
  }, []);

  const push = useCallback(
    (msg: ChatMsg) => {
      setMessages((prev) => {
        const next = [...prev, msg];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  /** Repart sur une conversation vierge (nouveau token côté serveur au
   *  prochain message ; l'ancien transcript reste consultable en admin). */
  const reset = () => {
    if (typing) return;
    tokenRef.current = undefined;
    setMessages([]);
    setInput("");
    setContactMode(false);
    setContactSent(false);
    setContactError(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    inputRef.current?.focus();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || typing) return;
    setInput("");
    push({ role: "user", text });
    setTyping(true);
    const startedAt = Date.now();
    try {
      const res = await sendChatMessage({
        sessionToken: tokenRef.current,
        message: text,
        locale,
      });
      tokenRef.current = res.sessionToken;
      await new Promise((r) => setTimeout(r, humanDelay(startedAt, res.reply.length)));
      push({ role: "assistant", text: res.reply });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        push({ role: "info", text: t.chat.rateLimited });
      } else {
        push({ role: "info", text: t.chat.unavailable });
        setContactMode(true);
      }
    } finally {
      setTyping(false);
    }
  };

  const submitContact = async () => {
    if (contactSending) return;
    setContactError(false);
    setContactSending(true);
    try {
      await sendChatContact({
        sessionToken: tokenRef.current,
        name: cName.trim(),
        email: cEmail.trim(),
        message: cMessage.trim(),
        locale,
      });
      setContactSent(true);
    } catch {
      setContactError(true);
    } finally {
      setContactSending(false);
    }
  };

  // Jamais sur le back-office : le widget est réservé au site public.
  if (pathname?.startsWith("/admin")) return null;

  const bubbleBase: React.CSSProperties = {
    maxWidth: "82%",
    padding: "9px 13px",
    borderRadius: 16,
    font: `400 14px/1.5 ${FONT}`,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #e0dfda",
    borderRadius: 10,
    padding: "9px 11px",
    font: `400 13.5px ${FONT}`,
    color: INK,
    background: "#fff",
    outline: "none",
  };

  return (
    <>
      {/* Bulle d'ouverture */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={t.chat.open}
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 190,
            width: 54,
            height: 54,
            borderRadius: "50%",
            border: "none",
            background: ACCENT,
            color: "#fff",
            cursor: "pointer",
            boxShadow: "0 10px 30px rgba(0,0,0,.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 6.5A3.5 3.5 0 0 1 7.5 3h9A3.5 3.5 0 0 1 20 6.5v6a3.5 3.5 0 0 1-3.5 3.5H10l-4.4 3.7c-.65.55-1.6.06-1.6-.77V6.5Z"
              fill="currentColor"
            />
          </svg>
        </button>
      )}

      {/* Panneau */}
      {open && (
        <div
          role="dialog"
          aria-label={t.chat.title}
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 190,
            width: "min(360px, calc(100vw - 32px))",
            height: "min(540px, calc(100dvh - 90px))",
            background: "#F5F4F1",
            borderRadius: 18,
            boxShadow: "0 18px 60px rgba(0,0,0,.26)",
            border: "1px solid #e6e5e1",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: FONT,
          }}
        >
          {/* En-tête */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              background: "#fff",
              borderBottom: "1px solid #ecebe7",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: ACCENT,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "400 18px Marcellus, serif",
                flexShrink: 0,
              }}
            >
              L
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: `600 14.5px ${FONT}`, color: INK }}>
                {t.chat.title} — {site.name}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  font: `400 12px ${FONT}`,
                  color: "#6B6E6B",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#3D9A50",
                    display: "inline-block",
                  }}
                />
                {t.chat.subtitle}
              </div>
            </div>
            {(messages.length > 0 || contactMode) && (
              <button
                onClick={reset}
                aria-label={t.chat.reset}
                title={t.chat.reset}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#6B6E6B",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M20 11a8 8 0 1 0-2.34 6M20 5v6h-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              aria-label={t.chat.close}
              style={{
                border: "none",
                background: "transparent",
                color: "#6B6E6B",
                cursor: "pointer",
                fontSize: 22,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ ...bubbleBase, background: "#fff", color: INK, alignSelf: "flex-start" }}>
              {t.chat.intro}
            </div>
            {messages.map((m, i) =>
              m.role === "info" ? (
                <div
                  key={i}
                  style={{
                    alignSelf: "center",
                    font: `400 12.5px/1.5 ${FONT}`,
                    color: "#6B6E6B",
                    textAlign: "center",
                    padding: "2px 10px",
                  }}
                >
                  {m.text}
                </div>
              ) : (
                <div
                  key={i}
                  style={{
                    ...bubbleBase,
                    ...(m.role === "user"
                      ? { background: ACCENT, color: "#fff", alignSelf: "flex-end" }
                      : { background: "#fff", color: INK, alignSelf: "flex-start" }),
                  }}
                >
                  {m.text}
                </div>
              ),
            )}
            {typing && (
              <div
                style={{
                  ...bubbleBase,
                  background: "#fff",
                  color: "#9A9C97",
                  alignSelf: "flex-start",
                  letterSpacing: 3,
                }}
              >
                <span className="chat-typing">•••</span>
              </div>
            )}

            {/* Formulaire « laisser un message » */}
            {contactMode && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 14,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  border: "1px solid #ecebe7",
                }}
              >
                {contactSent ? (
                  <p style={{ margin: 0, font: `400 13.5px/1.55 ${FONT}`, color: INK }}>
                    {t.chat.contactSent}
                  </p>
                ) : (
                  <>
                    <input
                      value={cName}
                      onChange={(e) => setCName(e.target.value)}
                      placeholder={t.chat.contactName}
                      style={fieldStyle}
                      maxLength={200}
                    />
                    <input
                      value={cEmail}
                      onChange={(e) => setCEmail(e.target.value)}
                      placeholder={t.chat.contactEmail}
                      type="email"
                      style={fieldStyle}
                      maxLength={320}
                    />
                    <textarea
                      value={cMessage}
                      onChange={(e) => setCMessage(e.target.value)}
                      placeholder={t.chat.contactMessage}
                      rows={3}
                      style={{ ...fieldStyle, resize: "vertical" }}
                      maxLength={3000}
                    />
                    {contactError && (
                      <p style={{ margin: 0, font: `400 12.5px ${FONT}`, color: "#B4423C" }}>
                        {t.chat.contactError}
                      </p>
                    )}
                    <button
                      onClick={submitContact}
                      disabled={
                        contactSending ||
                        !cName.trim() ||
                        !cEmail.includes("@") ||
                        !cMessage.trim()
                      }
                      style={{
                        border: "none",
                        background: INK,
                        color: "#fff",
                        borderRadius: 10,
                        padding: "10px 14px",
                        font: `600 13.5px ${FONT}`,
                        cursor: contactSending ? "wait" : "pointer",
                        opacity:
                          contactSending ||
                          !cName.trim() ||
                          !cEmail.includes("@") ||
                          !cMessage.trim()
                            ? 0.55
                            : 1,
                      }}
                    >
                      {t.chat.contactSend}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Saisie */}
          <div style={{ padding: "10px 12px 6px", background: "#fff", borderTop: "1px solid #ecebe7" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                placeholder={t.chat.placeholder}
                maxLength={1500}
                style={{ ...fieldStyle, flex: 1, background: "#F5F4F1", border: "1px solid #ecebe7" }}
              />
              <button
                onClick={send}
                disabled={typing || !input.trim()}
                aria-label={t.chat.send}
                style={{
                  border: "none",
                  background: ACCENT,
                  color: "#fff",
                  borderRadius: 10,
                  width: 42,
                  cursor: typing || !input.trim() ? "default" : "pointer",
                  opacity: typing || !input.trim() ? 0.55 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M3.4 20.4 21 12 3.4 3.6l2.9 6.9L14 12l-7.7 1.5-2.9 6.9Z" fill="currentColor" />
                </svg>
              </button>
            </div>
            {!contactMode && (
              <button
                onClick={() => setContactMode(true)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: ACCENT,
                  font: `500 12.5px ${FONT}`,
                  cursor: "pointer",
                  padding: "7px 0 3px",
                }}
              >
                {t.chat.leaveMessage}
              </button>
            )}
            <p
              style={{
                margin: "4px 0 6px",
                font: `400 10.5px/1.5 ${FONT}`,
                color: "#9A9C97",
                textAlign: "center",
              }}
            >
              {t.chat.aiNotice}
              <br />
              {t.chat.disclaimer}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
