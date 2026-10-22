"use client";

/** The last resort, when even the page around everything failed: no styles to rely on, so it brings its own. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#070a0e",
          color: "#efe6d6",
          font: "16px/1.6 Georgia, serif",
        }}
      >
        <main style={{ maxWidth: 520, margin: "14vh auto", padding: 24 }}>
          <h1 style={{ fontWeight: 400, fontSize: 32, margin: "0 0 12px" }}>4me didn&apos;t load</h1>
          <p>Something went wrong on our side. It is usually gone a moment later.</p>
          <p style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                font: "inherit",
                padding: "6px 14px",
                background: "#22304a",
                color: "#efe6d6",
                border: "1px solid #31415a",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a href="/" style={{ color: "#9cc2ff" }}>
              Back to tonight&apos;s page
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
