"use client";

import { useEffect, useState } from "react";
import type { BookingContext } from "@/lib/api";
import { DesktopFunnel } from "./DesktopFunnel";
import { MobileFunnel } from "./MobileFunnel";

/**
 * Single responsive entry point for the booking funnel.
 *
 * Desktop renders the two-column layout (« Prototype Desktop »); below 980px we
 * switch to the full-screen step wizard (« Prototype » mobile). We initialise to
 * desktop so the server render and first client render match (no hydration
 * mismatch), then correct on mount.
 */
export function BookingFunnel({
  ctx,
  resumeRef,
}: {
  ctx: BookingContext;
  resumeRef?: string | null;
}) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile ? (
    <MobileFunnel ctx={ctx} resumeRef={resumeRef} />
  ) : (
    <DesktopFunnel ctx={ctx} resumeRef={resumeRef} />
  );
}
