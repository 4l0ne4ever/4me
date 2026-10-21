import { notFound } from "next/navigation";
import { Desktop } from "@/components/Desktop";
import { loadDesktop } from "@/lib/load";

export const revalidate = 30;

/** The front desktop: the newest page from anyone, and the shared guestbook. */
export default async function Home() {
  const data = await loadDesktop();
  if (!data) notFound();
  return <Desktop data={data} />;
}
