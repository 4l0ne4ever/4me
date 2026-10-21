import { notFound } from "next/navigation";
import { DeskPage } from "@/components/DeskPage";
import { loadDesktop } from "@/lib/load";

export const revalidate = 30;

/** The front desktop: everyone's newest pages and notes; it belongs to nobody, so it opens no one's page. */
export default async function Home() {
  const data = await loadDesktop();
  if (!data) notFound();
  return <DeskPage data={data} />;
}
