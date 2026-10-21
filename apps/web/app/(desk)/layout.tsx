import type { ReactNode } from "react";
import { DeskShell } from "@/components/DeskShell";

/** Every diary page shares one computer, so moving between them never rebuilds it. */
export default function DeskLayout({ children }: { children: ReactNode }) {
  return <DeskShell>{children}</DeskShell>;
}
