import "./admin.css";
import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Back-office — ${site.name}`,
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
