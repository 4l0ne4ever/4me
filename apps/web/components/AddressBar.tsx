"use client";

import { avatarUrl, type Me } from "@4me/shared";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { fromAddress, toAddress } from "@/lib/address";
import { useDesk } from "./DeskShell";

/**
 * Back, Home (tonight's pages), My diary, and the address of what's open: type someone's name and press Enter to
 * go to their diary. A thin bar runs along it while a page is loading.
 */
export function AddressBar({ path, me }: { path: string; me: Me | null }) {
  const router = useRouter();
  const { navigate, pending, searchFor } = useDesk();
  const [value, setValue] = useState(toAddress(path));
  const [bad, setBad] = useState(false);

  useEffect(() => {
    setValue(toAddress(path));
    setBad(false);
  }, [path]);

  const go = (e: FormEvent) => {
    e.preventDefault();
    const target = fromAddress(value);
    setBad(false);
    // Anything that isn't a diary's address is a search: "mưa", "the last tram", "Lan Nguyễn".
    if (!target) return searchFor(value.trim());
    navigate(target);
  };

  return (
    <form className={`addr${pending ? " loading" : ""}`} onSubmit={go} aria-label="Go to a diary">
      <button type="button" className="addr-btn" aria-label="Back" onClick={() => router.back()}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button
        type="button"
        className="addr-btn"
        aria-label="Home: tonight's pages"
        title="Tonight"
        onClick={() => navigate("/")}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 8 8 2.5 14 8M4 7v6.5h3V10h2v3.5h3V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <button
        type="button"
        className="addr-btn addr-me"
        aria-label={me ? "My diary" : "Start a diary"}
        title={me ? "My diary" : "Start a diary"}
        onClick={() => (me ? navigate(`/u/${me.handle}`) : router.push("/welcome?start=register"))}
      >
        <img src={me ? avatarUrl(me.avatar) : "/photos/pic-229.jpg"} alt="" width={20} height={20} />
      </button>
      <label htmlFor="addr-input" className="sr">
        Address
      </label>
      <input
        id="addr-input"
        className={`addr-input${bad ? " bad" : ""}`}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
          setBad(false);
        }}
        onFocus={(e) => e.currentTarget.select()}
        aria-invalid={bad || undefined}
        title={bad ? "Type a name, like lan, or lan/a-page" : "A diary's name, or anything to search for"}
      />
      <button type="submit" className="addr-go">
        Go
      </button>
    </form>
  );
}
