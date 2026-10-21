"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { fromAddress, toAddress } from "@/lib/address";

/** Back, Home, and the address of what's open: type someone's name and press Enter to go to their diary. */
export function AddressBar({ path }: { path: string }) {
  const router = useRouter();
  const [value, setValue] = useState(toAddress(path));
  const [bad, setBad] = useState(false);

  useEffect(() => {
    setValue(toAddress(path));
    setBad(false);
  }, [path]);

  const go = (e: FormEvent) => {
    e.preventDefault();
    const target = fromAddress(value);
    if (!target) return setBad(true);
    setBad(false);
    router.push(target);
  };

  return (
    <form className="addr" onSubmit={go} aria-label="Go to a diary">
      <button type="button" className="addr-btn" aria-label="Back" onClick={() => router.back()}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button type="button" className="addr-btn" aria-label="Home: tonight's pages" onClick={() => router.push("/")}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 8 8 2.5 14 8M4 7v6.5h3V10h2v3.5h3V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
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
        title={bad ? "Type a name, like lan, or lan/a-page" : "Type someone's name and press Enter"}
      />
      <button type="submit" className="addr-go">
        Go
      </button>
    </form>
  );
}
