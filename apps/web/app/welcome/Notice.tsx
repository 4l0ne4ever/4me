import type { ReactNode } from "react";
import "./welcome.css";

/** The welcome screen with a single message on it: an address confirmed, emails stopped. */
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="welcome">
      <div className="wl-top" />
      <section className="wl-mid">
        <div className="wl-brand">
          <p className="wl-logo">4me</p>
          <h1>{title}</h1>
        </div>
        <div className="wl-divider" aria-hidden="true" />
        <div className="wl-users">
          <div className="wl-form wl-notice" style={{ marginLeft: 0 }}>
            {children}
          </div>
        </div>
      </section>
      <div className="wl-bottom" />
    </main>
  );
}
