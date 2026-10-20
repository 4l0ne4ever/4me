"use client";

import { useEffect, useState } from "react";

/** Sends the author's time-zone offset with the form, so "written at" keeps its local meaning. */
export function TzField() {
  const [offset, setOffset] = useState("0");
  useEffect(() => setOffset(String(new Date().getTimezoneOffset())), []);
  return <input type="hidden" name="tz" value={offset} />;
}
