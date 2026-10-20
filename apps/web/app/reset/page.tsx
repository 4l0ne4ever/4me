import type { Metadata } from "next";
import { ResetForm } from "./ResetForm";
import "../welcome/welcome.css";

// The token is in the address: never send it on as a referrer, never index the page.
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

type Search = { searchParams: Promise<Record<string, string | undefined>> };

export default async function ResetPage({ searchParams }: Search) {
  const { token } = await searchParams;
  return <ResetForm token={/^[0-9a-f]{64}$/.test(token ?? "") ? token! : ""} />;
}
