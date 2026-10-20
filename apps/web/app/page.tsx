import { Desktop } from "@/components/Desktop";
import { loadDesktop } from "@/lib/load";

export const revalidate = 30;

export default async function Home() {
  return <Desktop data={await loadDesktop()} />;
}
