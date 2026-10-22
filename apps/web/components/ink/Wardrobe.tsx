"use client";

import { BREEDS, type Breed, type InkLook, OUTFITS, type Outfit } from "@4me/shared";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "../Dialog";
import { BREED_INFO } from "./breeds";
import {
  COLLARS,
  DEFAULT_LOOK,
  EYES,
  FURS,
  framesFor,
  HAT_PALETTE,
  HAT_ROOM,
  hatFor,
  OUTFIT_NAMES,
  outfitToday,
  paletteFor,
  seasonalOutfit,
} from "./looks";
import { H, paint, W } from "./sprites";

/** Ink sitting in a look, hat and all. */
function SitCanvas({ look, hat = true }: { look: InkLook; hat?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H + HAT_ROOM);
    paint(ctx, framesFor(look.breed).sit, 0, HAT_ROOM, paletteFor(look));
    const outfit = hat ? outfitToday(look, new Date()) : null;
    if (outfit) {
      const h = hatFor(outfit, "sit");
      paint(ctx, h.rows, h.x, h.y, HAT_PALETTE);
    }
  }, [look, hat]);
  return <canvas ref={ref} width={W} height={H + HAT_ROOM} />;
}

/** The big picture of her, drawn large enough to see the collar. */
function InkPreview({ look }: { look: InkLook }) {
  return (
    <figure className="wd-preview">
      <SitCanvas look={look} />
      <figcaption>
        <span className="wd-tag" style={{ background: look.collar }} />
        {look.name || "Ink"}
      </figcaption>
    </figure>
  );
}

/** A row of colours to pick from, and any other colour. */
function Colours({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const name = useId();
  const other = !options.some((o) => o.id === value);
  return (
    <fieldset className="wd-row">
      <legend>{legend}</legend>
      <div className="wd-swatches">
        {options.map((o) => (
          <label key={o.id} className="wd-swatch" title={o.label}>
            <input type="radio" name={name} checked={value === o.id} onChange={() => onChange(o.id)} />
            <span style={{ background: o.id }} />
            <span className="sr">{o.label}</span>
          </label>
        ))}
        <label className={`wd-swatch wd-other${other ? " on" : ""}`} title="Another colour">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} />
          <span className="sr">Another colour</span>
        </label>
      </div>
    </fieldset>
  );
}

/** Ink's wardrobe: the name on her tag, her fur, eyes and collar, and her hat. */
export function Wardrobe({
  look,
  onSave,
  onClose,
}: {
  look: InkLook;
  onSave: (look: InkLook) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(look);
  const set = (patch: Partial<InkLook>) => setDraft((d) => ({ ...d, ...patch }));
  const season = seasonalOutfit(new Date());
  const hats: Array<{ id: InkLook["outfit"]; label: string }> = [
    { id: "season", label: `With the seasons (now: ${OUTFIT_NAMES[season].toLowerCase()})` },
    { id: "none", label: "Nothing" },
    ...OUTFITS.map((o: Outfit) => ({ id: o, label: OUTFIT_NAMES[o] })),
  ];
  const hatName = useId();
  const kindName = useId();
  /** A new kind of cat comes in its own colours; they can still be changed after. */
  const pickBreed = (breed: Breed) => set({ breed, fur: BREED_INFO[breed].fur, eyes: BREED_INFO[breed].eyes });
  const save = () => {
    onSave({ ...draft, name: draft.name.trim() || DEFAULT_LOOK.name });
    onClose();
  };

  return (
    <Dialog
      title={`Dress ${look.name} up`}
      wide
      icon={<InkPreview look={draft} />}
      onClose={onClose}
      buttons={
        <>
          <button
            type="button"
            className="btn ghost wd-reset"
            onClick={() => setDraft({ ...DEFAULT_LOOK, name: draft.name })}
          >
            Start over
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={save}>
            Done
          </button>
        </>
      }
    >
      <form
        className="wardrobe"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="wd-name">
          <span>Name on her tag</span>
          <input
            className="field"
            maxLength={16}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            data-autofocus
          />
        </label>
        <fieldset className="wd-row">
          <legend>Kind of cat</legend>
          <div className="wd-kinds">
            {BREEDS.map((b) => (
              <label key={b} className={`wd-kind${draft.breed === b ? " on" : ""}`} title={BREED_INFO[b].about}>
                <input type="radio" name={kindName} checked={draft.breed === b} onChange={() => pickBreed(b)} />
                <SitCanvas
                  look={{ ...draft, breed: b, fur: BREED_INFO[b].fur, eyes: BREED_INFO[b].eyes }}
                  hat={false}
                />
                <span>{BREED_INFO[b].label}</span>
              </label>
            ))}
          </div>
          <p className="wd-about">
            {BREED_INFO[draft.breed].about.replace(/^./, (c) => c.toUpperCase())}. Each kind has its own voice.
          </p>
        </fieldset>
        <Colours legend="Fur" options={FURS} value={draft.fur} onChange={(fur) => set({ fur })} />
        <Colours legend="Eyes" options={EYES} value={draft.eyes} onChange={(eyes) => set({ eyes })} />
        <Colours legend="Collar" options={COLLARS} value={draft.collar} onChange={(collar) => set({ collar })} />
        <fieldset className="wd-row">
          <legend>Hat</legend>
          <div className="wd-hats">
            {hats.map((h) => (
              <label key={h.id} className={`wd-hat${draft.outfit === h.id ? " on" : ""}`}>
                <input
                  type="radio"
                  name={hatName}
                  checked={draft.outfit === h.id}
                  onChange={() => set({ outfit: h.id })}
                />
                {h.label}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="wd-note">
          Saved to your account: she looks like this on every device you log on to, and only for you.
        </p>
      </form>
    </Dialog>
  );
}
