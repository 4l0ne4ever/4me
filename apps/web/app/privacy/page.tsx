import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What 4me keeps about its readers and writers, where it lives, and how to delete it.",
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
        4me is a place for night diaries. You can read without an account. Nothing here sells, shares or studies what
        you do: there are no ads, no analytics and no tracking pixels.
      </p>

      <h2>If you only read</h2>
      <ul>
        <li>No cookies are set.</li>
        <li>Your wallpaper and Ink&apos;s hunger are kept in your own browser, not on our servers.</li>
        <li>
          Your IP address is never stored. A salted, one-way hash of it counts a page as read once per visitor and keeps
          spam down; those counters are deleted after a day.
        </li>
      </ul>

      <h2>If you leave a note, sign a guestbook or report a page as a guest</h2>
      <ul>
        <li>We keep the name you typed, what you wrote, the time, and the same hashed IP, so spam can be traced.</li>
        <li>Anything with a link waits until the page&apos;s writer or the moderator approves it.</li>
        <li>A report keeps the reason you picked and your hashed IP, so one reader is only counted once.</li>
      </ul>

      <h2>If you make an account</h2>
      <ul>
        <li>
          Your email address, the name you show, your desktop&apos;s address, the line about you, the picture you
          picked, and Ink&apos;s state, so she remembers you on every device. Your name, address, line and picture are
          public; your email address is never shown on the site.
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
          One cookie keeps you signed in. It is signed, readable only by this site&apos;s server, and lasts until you
          log off or it expires.
        </li>
      </ul>

      <h2>If you write</h2>
      <ul>
        <li>
          Your pages, with their mood, weather, song and photos, are shown to everyone unless you set them to
          &ldquo;only me&rdquo; or keep them as drafts. So are your blasts and the lines in your Almost posted bin.
        </li>
        <li>
          Photos are shrunk in your browser before they leave it, and their hidden data (camera details and the location
          where they were taken) is removed, in your browser and again on our server.
        </li>
        <li>
          When you search for a song, your browser sends the words you type straight to Apple&apos;s music search, and
          playing a 30-second preview loads it from Apple&apos;s servers. Playing a whole song in the Mixtape loads
          YouTube&apos;s player (from its no-cookie domain) only when you press play.
        </li>
        <li>
          If you add a Last.fm username, what you listen to on Last.fm shows on your desktop. Leave it empty and nothing
          is fetched.
        </li>
      </ul>

      <h2>Subscriptions, reactions and search</h2>
      <ul>
        <li>
          Which diaries you subscribe to is yours alone: a diary only shows how many subscribers it has, never who.
        </li>
        <li>
          A reaction is counted once per reader: by account when you are signed in, by the hashed IP above when not.
          Reactions are deleted with your account.
        </li>
        <li>Search only ever looks through public pages and the names and addresses of active diaries.</li>
        <li>
          The lit windows on the skyline are only a count of open pages. Nobody is named, and nothing about it is kept.
        </li>
        <li>
          A sealed letter&apos;s words, song and photos are kept from everyone but its writer until its day, including
          from search and link previews.
        </li>
      </ul>

      <h2>Live updates and notifications</h2>
      <ul>
        <li>
          While a page is open, it keeps a connection to our server so new notes, shouts and BUZZes appear by
          themselves. It carries only what is already public, plus, when you are signed in, your own notifications.
        </li>
        <li>
          Notifications (a note on your page, a shout in your guestbook, a BUZZ, a reply) are kept for two months so you
          can see what you missed, and deleted with your account.
        </li>
        <li>
          Notifications from your computer itself are off unless you switch them on in the bell menu and your browser
          asks you to allow them.
        </li>
      </ul>

      <h2>Private messages</h2>
      <p>
        Messages you send in Messenger are kept in our database so the people in the conversation can read them later.
        Only they can read them through the site; the moderator has no screen for them. They are not end-to-end
        encrypted. If you block someone, neither of you can message the other until you unblock them; they aren&apos;t
        told. Leaving a group removes you from it. When you delete your account you leave every conversation, and the
        messages you sent stay for the others, signed &ldquo;a former reader&rdquo;.
      </p>

      <h2>Where it lives</h2>
      <ul>
        <li>The site runs on Vercel and the API on Cloudflare. The database is Neon Postgres in Singapore.</li>
        <li>
          Photos are kept in a private storage bucket (Cloudflare R2 or Amazon S3) and only served through our API.
        </li>
        <li>Password reset emails are sent through Resend.</li>
        <li>
          A song player (Spotify, YouTube or SoundCloud) loads from that service only on pages that have one; YouTube is
          loaded from its no-cookie domain.
        </li>
        <li>Everything travels over HTTPS.</li>
      </ul>

      <h2>Moderation</h2>
      <p>
        A page reported by three different readers is hidden until the moderator looks at it. The moderator can hide
        pages and suspend accounts that break the rules; a suspended account can still sign in, read and delete its own
        pages.
      </p>

      <h2>Taking it with you</h2>
      <p>
        Signed in, open <b>Start → My account → Download my diary</b>. You get a zip of every page you wrote (private
        ones and sealed letters too) as Markdown, with their photos, the notes readers left on them, your blasts, the
        almost-posted bin and your guestbook. It is made in your browser and goes nowhere else.
      </p>

      <h2>Deleting it</h2>
      <p>
        Signed in, open <b>Start → My account → Delete my account</b>. Your account, email, pages, photos, guestbook,
        picture, password hash and Google link are deleted straight away. Notes you left on other people&apos;s pages
        stay, signed &ldquo;a former reader&rdquo;. Any single page can be deleted from your Notepad. To have a guest
        note removed, sign the guestbook asking for it.
      </p>

      <p className="privacy-back">
        <Link href="/">Back to tonight&apos;s pages</Link>
      </p>
    </main>
  );
}
