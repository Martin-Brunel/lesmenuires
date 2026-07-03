"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Mail,
  Package,
  Send,
  Settings,
  Snowflake,
  Star,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import { adminApi, type Me } from "@/lib/admin-api";
import { Avatar } from "@/components/admin/Avatar";
import { Button } from "@/components/ui/button";
import { DialogProvider } from "@/components/admin/dialogs";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// Ordonné par usage : le quotidien (exploitation) d'abord, la configuration
// de l'offre ensuite.
const NAV = [
  { href: "/admin", label: "Tableau de bord", icon: LayoutDashboard, exact: true },
  { href: "/admin/planning", label: "Planning", icon: CalendarDays },
  { href: "/admin/reservations", label: "Réservations", icon: ClipboardList },
  { href: "/admin/contacts", label: "Contacts", icon: Users },
  { href: "/admin/finances", label: "Finances", icon: Wallet },
  { href: "/admin/avis", label: "Avis", icon: Star },
  { href: "/admin/disponibilites", label: "Dispos & tarifs", icon: CalendarRange },
  { href: "/admin/saisons", label: "Saisons", icon: Snowflake },
  { href: "/admin/prestations", label: "Prestations", icon: Package },
  { href: "/admin/emails", label: "E-mails auto", icon: Mail },
  { href: "/admin/campagnes", label: "Campagnes", icon: Send },
  { href: "/admin/editorial", label: "Contenu éditorial", icon: FileText },
  { href: "/admin/equipe", label: "Équipe", icon: UserCog },
  { href: "/admin/reglages", label: "Réglages", icon: Settings },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Pages accessibles sans session (connexion, définition du mot de passe).
  const isLogin =
    pathname === "/admin/login" || pathname === "/admin/definir-mot-de-passe";
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isLogin) {
      setChecked(true);
      return;
    }
    adminApi
      .me()
      .then(setMe)
      .catch(() => router.replace("/admin/login"))
      .finally(() => setChecked(true));
  }, [isLogin, router]);

  if (isLogin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        {children}
      </div>
    );
  }

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Chargement…
      </div>
    );
  }

  if (!me) return null; // redirecting to /admin/login

  const logout = async () => {
    await adminApi.logout().catch(() => {});
    router.replace("/admin/login");
  };

  return (
    <DialogProvider>
    <div className="min-h-screen flex bg-muted/20">
      <aside className="w-64 shrink-0 border-r bg-background flex flex-col sticky top-0 h-screen print:hidden">
        <div className="h-14 flex items-center px-5 border-b shrink-0">
          <span className="text-lg" style={{ fontFamily: "'Marcellus',serif" }}>
            L&apos;Adret
          </span>
          <span className="ml-2 text-xs text-muted-foreground">admin</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAV.map((n) => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t">
          <Link
            href="/admin/equipe"
            className="flex items-center gap-2.5 rounded-md px-3 pb-2 pt-1 hover:bg-accent"
            title="Mon compte"
          >
            <Avatar name={me.displayName || me.email} size={28} />
            <span className="min-w-0">
              <span className="block truncate text-sm">{me.displayName || "Admin"}</span>
              <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
            </span>
          </Link>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={logout}>
            <LogOut className="size-4" />
            Déconnexion
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-5xl p-8 print:max-w-none print:p-0">{children}</div>
      </main>
    </div>
    <Toaster />
    </DialogProvider>
  );
}
