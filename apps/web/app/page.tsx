import { redirect } from "next/navigation";

export default function Home() {
  // The booking funnel is the product entry point for now.
  redirect("/reserver");
}
