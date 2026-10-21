import type { Almost as AlmostItem, Author } from "@4me/shared";
import { hhmm, shortDate } from "@/lib/api";

export function Almost({ items, persona }: { items: AlmostItem[]; persona: Author | null }) {
  return (
    <div className="body paper almost">
      <p className="d-note">things {persona ? `${persona.name} wrote` : "written"} at 3 am and took back.</p>
      {!persona && <p>Every diary has its own bin. Open someone&apos;s diary to see the lines they took back.</p>}
      {persona && items.length === 0 && <p>The bin is empty tonight.</p>}
      {items.map((a) => (
        <div className="draft" key={a.id}>
          <s>{a.body}</s>
          <small>
            deleted {shortDate(a.deletedAt)}, {hhmm(a.deletedAt)}
          </small>
        </div>
      ))}
    </div>
  );
}
