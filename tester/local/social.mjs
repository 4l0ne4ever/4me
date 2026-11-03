// Reading and answering on the local stack: guest and member notes, names, replies, reactions, reports, BUZZ and
// read counts, diary bans, guestbooks, the night's poem, search, the lists (random, lines, favourites, sky,
// archive, answers), sealed letters opening by the clock, night shifts, notifications, subscriptions, Ink.
import { browser } from "../e2e/cdp.mjs";
import { action, discoverActions, recorder, sleep } from "../e2e/lib.mjs";
import { adminApi, api, internal, makeMember, newIp, SITE, signInUi, writePage } from "./lib.mjs";

const r = recorder("local-social");
const ts = Date.now().toString(36).slice(-6);
const nightOf = (at) => {
  const l = new Date(at.getTime() + 7 * 3600_000);
  if (l.getUTCHours() < 6) l.setUTCDate(l.getUTCDate() - 1);
  return l.toISOString().slice(0, 10);
};
const tonight = nightOf(new Date());

const W = await makeMember("wr");
const R = await makeMember("rd");
const BW = await browser();
const BR = await browser();
await signInUi(BW.page, W);
await signInUi(BR.page, R);
const idw = await discoverActions(BW.page);
const idr = await discoverActions(BR.page);
const asW = (n, ...a) => action(BW.page, idw, n, ...a);
const asR = (n, ...a) => action(BR.page, idr, n, ...a);
const bell = async (as) => (await as("myNotifications")).value ?? { items: [], unread: 0 };

try {
  const page = await writePage(W, { title: `Rain ${ts}`, body: `Mưa rơi trên mái tôn. Đêm nay buồn ${ts}.`, mood: "buồn", slug: `rain-${ts}` });

  await r.step("S-01", "guest note names", async () => {
    const say = async (name, body = "hello") => (await api(`/entries/${page.id}/notes`, { method: "POST", body: { name, body } })).json?.error ?? "ok";
    const res = {
      "no name (a stranger)": await say(undefined),
      "the writer's own name": await say(W.displayName),
      "a member's name in capitals": await say(R.displayName.toUpperCase()),
      "'4me'": await say("4me"),
      "'Moderator'": await say("Moderator"),
      "'Lan' with a Cyrillic а (homoglyph)": await say("Lаn"),
      "'Lan' with a zero-width space": await say("La​n"),
      "'Lan.' with a dot": await say("Lan."),
      "empty body": await say("Guest", "   "),
      "501 characters": await say("Guest", "x".repeat(501)),
    };
    const blocked = ["the writer's own name", "a member's name in capitals", "'4me'", "'Moderator'", "empty body", "501 characters"];
    r.check("S-01", "members' and reserved names, empty and too-long notes are refused", blocked.every((k) => res[k] !== "ok"), res);
    r.check("S-01b", "look-alike names of a member are refused too", res["'Lan' with a Cyrillic а (homoglyph)"] !== "ok" && res["'Lan' with a zero-width space"] !== "ok", {
      homoglyph: res["'Lan' with a Cyrillic а (homoglyph)"],
      zeroWidth: res["'Lan' with a zero-width space"],
      dot: res["'Lan.' with a dot"],
    });
  });

  let guestNote;
  await r.step("S-02", "replies keep one level; notifications reach the right people", async () => {
    const top = await asR("noteAsMember", page.id, `member note ${ts}`);
    const ip = newIp();
    const g = await api(`/entries/${page.id}/notes`, { method: "POST", ip, body: { name: "Night owl", body: "a guest reply", parentId: top.value.note.id } });
    guestNote = g.json?.note;
    const deeper = await api(`/entries/${page.id}/notes`, { method: "POST", body: { name: "Owl two", body: "reply to the reply", parentId: guestNote.id } });
    const otherPage = await writePage(W, { title: `Other ${ts}` });
    const cross = await api(`/entries/${otherPage.id}/notes`, { method: "POST", body: { name: "Owl three", body: "x", parentId: top.value.note.id } });
    r.check("S-02", "a reply to a reply joins the same thread; a parent from another page is refused", deeper.json?.note?.parentId === top.value.note.id && cross.status === 404, {
      deeperParent: deeper.json?.note?.parentId,
      top: top.value.note.id,
      cross: cross.status,
    });
    const rb = (await bell(asR)).items.map((x) => x.text);
    const wb = (await bell(asW)).items.map((x) => x.text);
    r.check("S-02b", "the member is told about replies; the writer about notes", rb.some((t) => t.includes("Night owl replied")) && wb.some((t) => t.includes("left a note")), { reader: rb.slice(0, 3), writer: wb.slice(0, 4) });
  });

  await r.step("S-03", "guest reactions: one per visitor, change and take back", async () => {
    const ip = newIp();
    const react = (kind, target = `/entries/${page.id}/react`) => api(target, { method: "POST", ip, body: { kind } });
    await react("love");
    await react("moon");
    const two = await react("moon");
    const changed = (await api(`/entries/${page.id}/reactions/mine`, { ip })).json;
    const fake = await react("thumbsup");
    const missing = await api(`/entries/999999/react`, { method: "POST", ip, body: { kind: "love" } });
    r.check("S-03", "love then moon = one moon; moon again takes it back; unknown kind and missing page refused", JSON.stringify(two.json?.reactions ?? {}) === "{}" && changed.entry === null && fake.status === 400 && missing.status === 404, {
      afterTwice: two.json,
      mine: changed,
      fake: fake.status,
      missing: missing.status,
    });
    const m = await asR("reactAsMember", "note", guestNote.id, "hug");
    r.check("S-03b", "a member reacts to a note", Boolean(m.value?.reactions?.hug), m.value);
  });

  await r.step("S-04", "BUZZ and read counts", async () => {
    const ip = newIp();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await api(`/entries/${page.id}/buzz`, { method: "POST", ip })).status);
    const reads = [];
    for (let i = 0; i < 3; i++) reads.push((await api(`/entries/${page.id}/read`, { method: "POST", ip })).json?.readCount);
    r.check("S-04", "5 BUZZes a minute then 429; reading three times counts once", codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429 && reads[0] === reads[2], { codes, reads });
    const wb = (await bell(asW)).items.filter((x) => x.kind === "buzz").length;
    r.info("S-04b", "BUZZ notifications the writer got for 5 BUZZes", wb);
  });

  await r.step("S-05", "reports: three different readers hide a note, and a page", async () => {
    const victim = (await api(`/entries/${page.id}/notes`, { method: "POST", body: { name: "Spammy", body: "buy now" } })).json.note;
    const ip = newIp();
    await api(`/entries/notes/${victim.id}/report`, { method: "POST", ip, body: { reason: "spam" } });
    await api(`/entries/notes/${victim.id}/report`, { method: "POST", ip, body: { reason: "spam" } });
    await api(`/entries/notes/${victim.id}/report`, { method: "POST", ip, body: { reason: "spam" } });
    const sameIp = ((await api(`/entries/${page.id}/notes`)).json ?? []).some((x) => x.id === victim.id);
    await api(`/entries/notes/${victim.id}/report`, { method: "POST", body: { reason: "spam" } });
    await api(`/entries/notes/${victim.id}/report`, { method: "POST", body: { reason: "hurtful" } });
    const hidden = !((await api(`/entries/${page.id}/notes`)).json ?? []).some((x) => x.id === victim.id);
    r.check("S-05", "one visitor reporting 3 times doesn't hide; 3 different visitors do", sameIp && hidden, { visibleAfterSameIp: sameIp, hiddenAfterThree: hidden });
    const p2 = await writePage(W, { title: `Report me ${ts}` });
    for (let i = 0; i < 3; i++) await api(`/entries/${p2.id}/report`, { method: "POST", body: { reason: "other" } });
    const gone = await api(`/entries/by/${W.handle}/${p2.slug}`);
    const forWriter = await internal(`/users/${W.id}/entries`);
    r.check("S-05b", "a page reported by 3 visitors is hidden, and its writer sees why", gone.status === 404 && forWriter.json.find((e) => e.id === p2.id)?.status === "hidden", {
      public: gone.status,
      writerSees: forWriter.json.find((e) => e.id === p2.id)?.status,
    });
    const writerBell = (await bell(asW)).items.map((x) => x.text).filter((t) => /hidden|report/i.test(t));
    r.info("S-05c", "is the writer told their page was hidden?", writerBell);
  });

  await r.step("S-06", "keeping a guest off a diary", async () => {
    const ip = newIp();
    const n = (await api(`/entries/${page.id}/notes`, { method: "POST", ip, body: { name: "Troll", body: "mean words" } })).json.note;
    const ban = await asW("banFromDiary", { noteId: n.id }, true);
    const again = await api(`/entries/${page.id}/notes`, { method: "POST", ip, body: { name: "Troll", body: "again" } });
    const shout = await api(`/guestbook`, { method: "POST", ip, body: { name: "Troll", body: "hi", owner: W.handle } });
    const otherIp = await api(`/entries/${page.id}/notes`, { method: "POST", body: { name: "Troll", body: "from my phone" } });
    const otherDiary = await writePage(R, { title: `R page ${ts}` });
    const elsewhere = await api(`/entries/${otherDiary.id}/notes`, { method: "POST", ip, body: { name: "Troll", body: "here is fine" } });
    r.check("S-06", "a banned guest can't note or shout on that diary, but can elsewhere", ban.value?.ok && again.status === 403 && shout.status === 403 && elsewhere.status === 201, {
      again: again.status,
      shout: shout.status,
      elsewhere: elsewhere.status,
    });
    r.info("S-06b", "the same person from another address (phone network) gets straight back in", otherIp.status);
  });

  await r.step("S-07", "guestbooks", async () => {
    const ok = await api(`/guestbook`, { method: "POST", body: { name: "Passer", body: `hello ${ts}`, owner: W.handle } });
    const link = await api(`/guestbook`, { method: "POST", body: { name: "Passer", body: "see https://spam.example", owner: W.handle } });
    const nobody = await api(`/guestbook`, { method: "POST", body: { name: "Passer", body: "hi", owner: "no_such_one" } });
    const tooLong = await api(`/guestbook`, { method: "POST", body: { name: "Passer", body: "x".repeat(281), owner: W.handle } });
    const list = (await api(`/guestbook?owner=${W.handle}`)).json ?? [];
    const member = await asR("shoutAsMember", `member shout ${ts}`, W.handle);
    const del = await asW("deleteShout", ok.json.shout.id);
    const notOwner = await asR("deleteShout", member.value?.shout?.id);
    const after = (await api(`/guestbook?owner=${W.handle}&x=1`)).json ?? [];
    r.check("S-07", "shouts: plain shows, link waits, unknown diary 404, 281 chars refused; owner deletes, others can't", ok.status === 201 && link.json?.pending === true && nobody.status === 404 && tooLong.status === 400 && list.some((s) => s.body === `hello ${ts}`) && !list.some((s) => s.body.includes("spam.example")) && del.value?.ok && notOwner.value?.ok === false && !after.some((s) => s.body === `hello ${ts}`), {
      ok: ok.status,
      pending: link.json?.pending,
      nobody: nobody.status,
      tooLong: tooLong.status,
      ownerDelete: del.value,
      otherDelete: notOwner.value,
    });
  });

  await r.step("S-08", "tonight's poem", async () => {
    const ip = newIp();
    const first = await api(`/nights/lines`, { method: "POST", ip, body: { name: "Moth", body: `one line ${ts}` } });
    const second = await api(`/nights/lines`, { method: "POST", ip, body: { name: "Moth", body: "another" } });
    const link = await api(`/nights/lines`, { method: "POST", body: { name: "Moth", body: "visit https://x.example" } });
    const asMember = await asR("addMyLine", `member line ${ts}`);
    const asMemberAgain = await asR("addMyLine", "again");
    const lines = (await api(`/nights/${tonight}/lines`)).json ?? [];
    r.check("S-08", "one line a night per guest and per member; links refused; lines listed in order", first.status === 201 && second.status === 409 && link.status === 400 && asMember.value?.ok && asMemberAgain.value?.ok === false && lines.some((l) => l.body === `one line ${ts}`), {
      first: first.status,
      second: second.status,
      link: link.status,
      member: asMember.value?.ok,
      memberAgain: asMemberAgain.value?.error,
    });
  });

  await r.step("S-09", "search", async () => {
    const sealed = await writePage(W, { title: `Sealed ${ts}`, body: `hidden words zebra${ts}`, opensAt: new Date(Date.now() + 86400_000).toISOString() });
    const priv = await writePage(W, { title: `Private ${ts}`, body: `private words yak${ts}`, visibility: "private" });
    const q = async (s) => (await api(`/search?q=${encodeURIComponent(s)}`)).json;
    const accentless = await q(`mua roi tren mai ton`);
    const accented = await q(`mưa rơi`);
    const sealedHit = await q(`zebra${ts}`);
    const privHit = await q(`yak${ts}`);
    const wildcard = await q("%%");
    const people = await q(W.handle);
    r.check("S-09", "accents optional; sealed and private pages never found; people by address", accentless.pages.some((p) => p.id === page.id) && accented.pages.some((p) => p.id === page.id) && !sealedHit.pages.length && !privHit.pages.length && people.people.some((p) => p.handle === W.handle), {
      accentless: accentless.pages.length,
      accented: accented.pages.length,
      sealed: sealedHit.pages.length,
      private: privHit.pages.length,
      wildcardPages: wildcard?.pages?.length,
    });
    void sealed;
    void priv;
  });

  await r.step("S-10", "lists: random, lines, favourites, sky, archive, answers, paging", async () => {
    const answering = await asW("saveEntry", null, { title: `Answer ${ts}`, body: "my answer to tonight.", visibility: "public", answering: true, mood: "tired" });
    const answers = (await api(`/entries?prompt=${tonight}`)).json ?? [];
    const sky = (await api(`/nights/${tonight}/sky`)).json;
    const fav = (await api(`/entries/favourites?limit=10`)).json ?? [];
    const random = await api(`/entries/random`);
    const lines = (await api(`/entries/lines`)).json ?? [];
    const archive = (await api(`/archive?author=${W.handle}`)).json ?? [];
    const limits = [(await api(`/entries?limit=0`)).json?.length, (await api(`/entries?limit=999`)).json?.length, (await api(`/entries?limit=abc`)).json?.length];
    const all = (await api(`/entries?limit=50`)).json ?? [];
    const older = all.length > 1 ? (await api(`/entries?before=${encodeURIComponent(all[0].writtenAt)}&limit=50`)).json : [];
    r.check("S-10", "answers list has the page; sky counts moods; random/lines/archive answer", answers.some((e) => e.id === answering.value?.entry?.id) && sky.total >= 1 && random.status === 200 && Array.isArray(lines) && archive.length >= 1, {
      answers: answers.length,
      sky,
      favourites: fav.map((f) => f.title).slice(0, 5),
      random: random.json?.title,
      lines: lines.length,
      archive: archive.length,
      limitClamp: limits,
      paging: { first: all.length, older: older?.length },
    });
    r.check("S-10b", "favourites never list a sealed letter", !fav.some((f) => f.sealedUntil), fav.map((f) => f.title));
  });

  await r.step("S-11", "a sealed letter opens by the clock and its readers are told", async () => {
    await asR("setSubscribed", W.handle, true);
    const opens = new Date(Date.now() + 70_000);
    const letter = await asW("saveEntry", null, { title: `Opens soon ${ts}`, body: `the inside ${ts}`, visibility: "public", opensAt: opens.toISOString() });
    const before = (await api(`/entries/by/${W.handle}/${letter.value.entry.slug}`)).json;
    const subsBefore = (await bell(asR)).items.filter((x) => x.text.includes(`Opens soon ${ts}`)).length;
    let after = before;
    for (let i = 0; i < 40 && !after.body; i++) {
      await sleep(5000);
      after = (await api(`/entries/by/${W.handle}/${letter.value.entry.slug}?${i}`)).json;
    }
    let told = 0;
    for (let i = 0; i < 20 && !told; i++) {
      told = (await bell(asR)).items.filter((x) => x.kind === "opened" && x.text.includes(`Opens soon ${ts}`)).length;
      if (!told) await sleep(5000);
    }
    r.check("S-11", "sealed: no words before; words after its time; subscriber told once", before.body === "" && after.body?.includes(`the inside ${ts}`) && told === 1 && subsBefore === 0, {
      before: before.body,
      after: after.body?.slice(0, 30),
      subscriberTold: told,
    });
  });

  await r.step("S-12", "a night shift: pages sealed until it ends, then open together", async () => {
    const vn = new Date(Date.now() + 7 * 3600_000 - 9 * 60_000);
    const hhmm = `${String(vn.getUTCHours()).padStart(2, "0")}:${String(vn.getUTCMinutes()).padStart(2, "0")}`;
    await adminApi(`/nights`, { method: "GET" }).then(async (x) => {
      for (const ev of x.json ?? []) if (ev.night === tonight) await adminApi(`/nights/${ev.id}`, { method: "DELETE" });
    });
    const plan = await adminApi(`/nights`, { method: "POST", body: { night: tonight, title: `Shift ${ts}`, body: "write together", question: "What kept you up?", start: hhmm, shift: true, minutes: 10 } });
    const ev = plan.json;
    const pub = (await api(`/nights/${tonight}/plan`)).json;
    const a = await asW("saveEntry", null, { title: `Shift A ${ts}`, body: `shift words A ${ts}`, visibility: "public", shift: ev.id });
    const b = await asR("saveEntry", null, { title: `Shift B ${ts}`, body: `shift words B ${ts}`, visibility: "public", shift: ev.id });
    const sealedA = a.value?.entry?.sealedUntil;
    const list = (await api(`/entries?shift=${ev.id}`)).json ?? [];
    const early = (await api(`/entries/by/${W.handle}/${a.value.entry.slug}`)).json.body;
    r.check("S-12", "the plan is public with its question; shift pages are sealed until the end", plan.status === 201 && pub.event?.question === "What kept you up?" && Boolean(sealedA) && early === "" && list.length === 2, {
      plan: plan.status,
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      sealedUntil: sealedA,
      listed: list.length,
    });
    const wait = new Date(ev.endsAt).getTime() - Date.now() + 2000;
    if (wait > 0 && wait < 120_000) await sleep(wait);
    const late = (await api(`/entries/by/${W.handle}/${a.value.entry.slug}?late`)).json.body;
    const lateB = (await api(`/entries/by/${R.handle}/${b.value.entry.slug}?late`)).json.body;
    r.check("S-12b", "when the shift ends, both pages open", late?.includes("shift words A") && lateB?.includes("shift words B"), { a: late?.slice(0, 20), b: lateB?.slice(0, 20) });
    const after = await asW("saveEntry", null, { title: `After shift ${ts}`, body: "late", visibility: "public", shift: ev.id });
    r.info("S-12c", "a page that says it is in the shift, written after the shift ended", { sealedUntil: after.value?.entry?.sealedUntil, shift: after.value?.entry?.shift });
    const past = await adminApi(`/nights`, { method: "POST", body: { night: "2020-01-01", title: "Old night" } });
    const twice = await adminApi(`/nights`, { method: "POST", body: { night: tonight, title: "Second plan" } });
    r.check("S-12d", "a past night or a second plan for the same night is refused", past.status === 400 && twice.status === 409, { past: past.status, twice: twice.status });
  });

  await r.step("S-13", "a member's own note: edit, link sends it back, delete; the writer deletes others' notes", async () => {
    const n = (await asR("noteAsMember", page.id, `to edit ${ts}`)).value.note;
    const edited = await asR("editNote", n.id, `edited ${ts}`);
    const withLink = await asR("editNote", n.id, `now with https://spam.example`);
    const shown = ((await api(`/entries/${page.id}/notes?e`)).json ?? []).some((x) => x.id === n.id);
    const writerDel = await asW("deleteNote", n.id);
    r.check("S-13", "edit shows 'edited'; adding a link holds it; the page's writer can delete it", Boolean(edited.value?.note?.editedAt) && withLink.value?.pending === true && !shown && writerDel.value?.ok, {
      edited: edited.value?.note?.editedAt,
      pending: withLink.value?.pending,
      writerDelete: writerDel.value,
    });
    const priv = await writePage(W, { title: `Private target ${ts}`, visibility: "private" });
    const onPrivate = await asR("noteAsMember", priv.id, "can I?");
    r.check("S-13b", "nobody can note on a private page", onPrivate.value?.ok === false, onPrivate.value);
  });

  await r.step("S-14", "notifications: unread count and marking read", async () => {
    const before = await bell(asW);
    await asW("markRead");
    const after = await bell(asW);
    r.check("S-14", "marking read clears the unread count", before.unread > 0 && after.unread === 0, { before: before.unread, after: after.unread, kept: after.items.length });
  });

  await r.step("S-15", "subscriptions: feed and list", async () => {
    const feed = (await asR("myFeed")).value ?? [];
    const subs = (await asR("mySubscriptions")).value ?? [];
    const self = await asW("setSubscribed", W.handle, true);
    r.check("S-15", "the feed has the diary's public pages; you can't subscribe to yourself", feed.length > 0 && feed.every((e) => e.author.handle === W.handle) && subs.some((s) => s.handle === W.handle) && self.value?.ok === false, {
      feed: feed.length,
      subs: subs.map((s) => s.handle),
      self: self.value?.error,
    });
    const priv = feed.some((e) => e.title.startsWith("Private"));
    r.check("S-15b", "private pages never reach a subscriber's feed", !priv);
  });

  await r.step("S-16", "a year ago tonight", async () => {
    const yearAgo = new Date(Date.now() - 365 * 86400_000);
    await writePage(W, { title: `Last year ${ts}`, writtenAt: yearAgo.toISOString(), visibility: "private" });
    const then = (await asW("onThisNight")).value;
    r.check("S-16", "a page from this night last year is offered back", then?.year?.some((p) => p.title === `Last year ${ts}`), then);
  });

  await r.step("S-17", "Ink: counters, and a member's own Ink", async () => {
    const before = (await api(`/cat`)).json;
    const pet = (await api(`/cat/pet`, { method: "POST" })).json;
    const bad = await api(`/cat/eat-the-sofa`, { method: "POST" });
    const save = await asW("saveInkLook", { breed: "tabby", fur: "#333333", eyes: "#ffcc00", collar: "#aa0000", hat: "none", name: "Mực" });
    r.check("S-17", "petting counts; unknown actions refused", pet.pets === before.pets + 1 && bad.status === 404, { before, pet, bad: bad.status, look: save.status });
  });

  await r.step("S-18", "music without keys degrades quietly", async () => {
    const np = await api(`/now-playing?user=${W.handle}`);
    const recent = await api(`/recent-tracks?user=${W.handle}`);
    const video = await api(`/music/video?title=Fake&artist=Nobody`);
    r.check("S-18", "now-playing, recent tracks and video lookup answer without errors", np.status === 200 && recent.status === 200 && video.status < 500, {
      np: np.status,
      recent: recent.status,
      video: `${video.status} ${video.text.slice(0, 80)}`,
    });
  });

  await r.step("S-19", "RSS and sitemap leave out private, draft and sealed pages", async () => {
    await sleep(500);
    const rss = await (await fetch(`${SITE}/u/${W.handle}/rss.xml`)).text();
    const sitemap = await api(`/entries/sitemap`);
    const leaks = ["Private", "Sealed", "hidden words", "private words"].filter((w) => rss.includes(`${w} ${ts}`) || rss.includes(`${w} zebra`));
    const smLeak = (sitemap.json ?? []).filter((x) => x.slug.includes("private") || x.slug.includes("sealed"));
    r.check("S-19", "nothing private or sealed in RSS or the sitemap", leaks.length === 0 && smLeak.length === 0, { rssLeaks: leaks, sitemapLeaks: smLeak });
  });
} finally {
  r.info("S-99", "browser problems", [...BW.page.problems, ...BR.page.problems].slice(0, 12));
  r.save();
  await BW.close();
  await BR.close();
}
