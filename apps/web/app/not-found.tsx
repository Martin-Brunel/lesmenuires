import Link from "next/link";
import { getDict, localePath } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n/server";

export default async function NotFound() {
  const locale = await requestLocale();
  const t = getDict(locale);
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        padding: "2rem",
        textAlign: "center",
        background: "#faf8f5",
        color: "#1f2a33",
      }}
    >
      <p style={{ fontSize: "0.8rem", letterSpacing: "0.2em", color: "#4E6E8C" }}>
        {t.notFound.kicker}
      </p>
      <h1 style={{ fontFamily: "Marcellus, serif", fontSize: "2.25rem", margin: 0 }}>
        {t.notFound.title}
      </h1>
      <p style={{ maxWidth: "28rem", color: "#5b6670", lineHeight: 1.6 }}>
        {t.notFound.body}
      </p>
      <Link
        href={localePath(locale, "/")}
        style={{
          marginTop: "0.5rem",
          padding: "0.75rem 1.5rem",
          borderRadius: "999px",
          background: "#4E6E8C",
          color: "#fff",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        {t.notFound.backHome}
      </Link>
    </main>
  );
}
