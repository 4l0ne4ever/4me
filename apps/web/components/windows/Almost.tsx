import type { Almost as AlmostItem } from "@4me/shared";
import { hhmm, shortDate } from "@/lib/api";

export function Almost({ items }: { items: AlmostItem[] }) {
  return (
    <div className="body paper almost">
      <p className="d-note">things i wrote at 3 am and took back.</p>
      {items.length === 0 && <p>The bin is empty tonight.</p>}
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
