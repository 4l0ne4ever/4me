import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What 4me keeps about its readers, where it lives, and how to delete it.",
};

const UPDATED = "20 October 2026";

/** Plain and short on purpose: it says exactly what the code stores, and nothing else. */
export default function Privacy() {
  return (
    <main className="paper privacy">
      <p className="d-note">the small print, written plainly.</p>
      <h1 className="d-title">Privacy</h1>
      <p className="privacy-updated">Last changed {UPDATED}</p>

      <p>
        4me is one person&apos;s night diary. You can read it without an account. Nothing here sells, shares or
        studies what you do: there are no ads, no analytics and no tracking pixels.
      </p>

      <h2>If you only read</h2>
      <ul>
        <li>No cookies are set.</li>
        <li>Your wallpaper and Ink&apos;s hunger are kept in your own browser, not on our servers.</li>
        <li>
          Your IP address is never stored. A salted, one-way hash of it counts a page as read once per visitor and keeps
          spam down; those counters are deleted after an hour.
        </li>
      </ul>

      <h2>If you leave a note or sign the guestbook as a guest</h2>
      <ul>
        <li>We keep the name you typed, what you wrote, the time, and the same hashed IP, so spam can be traced.</li>
        <li>Anything with a link waits until the author approves it.</li>
      </ul>

      <h2>If you make an account</h2>
      <ul>
        <li>
          Your email address, the name you show, the picture you picked, and Ink&apos;s state, so she remembers you on
          every device.
        </li>
        <li>
          Your password is never stored, only a scrypt hash of it. A password reset link is stored as a hash too, and
          expires after an hour.
        </li>
        <li>
          With Google, we receive your Google account ID, email address and name, and nothing else (the scopes are{" "}
          <code>openid email profile</code>). We never see your Google password and can&apos;t post anything for you.
        </li>
        <li>
          One cookie keeps you signed in. It is signed, readable only by this site&apos;s server, and lasts until you log
          off or it expires.
        </li>
        <li>Your email address is never shown on the site.</li>
      </ul>

      <h2>Where it lives</h2>
      <ul>
        <li>The site runs on Vercel and the API on Cloudflare. The database is Neon Postgres in Singapore.</li>
        <li>Password reset emails are sent through Resend.</li>
        <li>
          A song player (Spotify, YouTube or SoundCloud) loads from that service only on pages that have one; YouTube is
          loaded from its no-cookie domain.
        </li>
        <li>Everything travels over HTTPS.</li>
      </ul>

      <h2>Deleting it</h2>
      <p>
        Signed in, open <b>Start → My account → Delete my account</b>. Your account, email, picture, password hash and
        Google link are deleted straight away. Notes you left stay in the diary, signed &ldquo;a former reader&rdquo;.
        To have a guest note removed, sign the guestbook asking for it.
      </p>

      <p className="privacy-back">
        <Link href="/">Back to tonight&apos;s page</Link>
      </p>
    </main>
  );
}
