import Link from "next/link";

export default function NotFound() {
  return (
    <main className="paper" style={{ maxWidth: 560, margin: "12vh auto", padding: 32 }}>
      <p className="d-note">this page isn&apos;t in the diary.</p>
      <h1 className="d-title">Nothing written here</h1>
      <p style={{ fontSize: 18, lineHeight: 1.6 }}>
        It may have been moved to the bin, or it was never posted. <Link href="/">Go back to tonight&apos;s page</Link>.
      </p>
    </main>
  );
}
