// Two members on the live site: A writes, B reads. Subscriptions and the bell, notes and replies, held notes,
// keeping someone off a diary, Messenger and blocking, reaching into the other's things by id, and signing out
// everywhere. Server actions are called the way the page's own buttons call them, with each member's session.
//   A_EMAIL A_PASSWORD B_EMAIL B_PASSWORD
import { browser } from "./cdp.mjs";
import { API, action, discoverActions, guest, me, recorder, SITE, signIn, sleep } from "./lib.mjs";

const r = recorder("cross-run");
const ts = Date.now().toString(36);
const A = await browser();
const B = await browser();
const B2 = await browser(); // B again, on a second device
const G = await browser(); // a guest

const made = [];
let a;
let b;
let ida;
let idb;
const callA = (name, ...args) => action(A.page, ida, name, ...args);
const callB = (name, ...args) => action(B.page, idb, name, ...args);
const bell = async (call) => (await call("myNotifications")).value?.items ?? [];

try {
  await signIn(A.page, process.env.A_EMAIL, process.env.A_PASSWORD);
  await signIn(B.page, process.env.B_EMAIL, process.env.B_PASSWORD);
  a = await me(A.page);
  b = await me(B.page);
  ida = await discoverActions(A.page);
  idb = await discoverActions(B.page);
  r.info("X-00", "signed in", { A: a.handle, B: b.handle });

  let page1;
  await r.step("X-01", "subscribe, then a new public page rings the bell and arrives live", async () => {
    const sub = await callB("setSubscribed", a.handle, true);
    const profile = JSON.parse((await guest(`${API}/profiles/${a.handle}?${ts}`)).body);
    r.check("X-01", "B subscribes to A's diary", sub.value?.ok === true, { subscribers: profile.subscribers });
    await G.page.goto(`${SITE}/`, 3000);
    const before = (await bell(callB)).length;
    const res = await callA("saveEntry", null, {
      title: `[QA] cross ${ts}`,
      body: "a page for B",
      visibility: "public",
      slug: `qa-${ts}-x1`,
    });
    page1 = res.value?.entry;
    if (page1) made.push(page1.id);
    await sleep(4000);
    const items = await bell(callB);
    const post = items.find((n) => n.kind === "post" && n.text.includes(`[QA] cross ${ts}`));
    r.check("X-01b", "B's bell has the new page", Boolean(post), { before, after: items.length, text: post?.text });
    const live = await G.page.eval(`document.body.innerText.includes("[QA] cross ${ts}")`);
    r.check("X-01c", "a guest's open Tonight shows it without reloading", live);
  });

  await r.step("X-02", "a draft published later", async () => {
    await G.page.goto(`${SITE}/`, 3000);
    const draft = await callA("saveEntry", null, {
      title: `[QA] draft ${ts}`,
      body: "draft first",
      visibility: "draft",
      slug: `qa-${ts}-x2`,
    });
    const e = draft.value?.entry;
    if (e) made.push(e.id);
    const pub = await callA("saveEntry", e.id, {
      title: `[QA] draft ${ts}`,
      body: "draft first",
      visibility: "public",
      slug: `qa-${ts}-x2`,
    });
    await sleep(5000);
    const post = (await bell(callB)).find((n) => n.kind === "post" && n.text.includes(`[QA] draft ${ts}`));
    const live = await G.page.eval(`document.body.innerText.includes("[QA] draft ${ts}")`);
    r.check("X-02", "B is told when A publishes a draft (F3)", Boolean(post), {
      published: pub.value?.ok,
      bell: Boolean(post),
      liveInTonight: live,
    });
  });

  let noteB;
  let replyA;
  await r.step("X-03", "notes and replies tell the right person", async () => {
    const n = await callB("noteAsMember", page1.id, `[QA] hello from B ${ts}`);
    noteB = n.value?.note;
    r.check("X-03", "B leaves a note", Boolean(noteB) && n.value?.pending === false, n.value);
    await sleep(2000);
    const toA = (await bell(callA)).find((x) => x.kind === "note" && x.text.includes(b.displayName));
    r.check("X-03b", "A is told", Boolean(toA), toA?.text);
    const rep = await callA("noteAsMember", page1.id, `[QA] reply from A ${ts}`, noteB.id);
    replyA = rep.value?.note;
    await sleep(2000);
    const toB = (await bell(callB)).find((x) => x.kind === "reply" && x.text.includes(a.displayName));
    r.check("X-03c", "B is told about the reply", Boolean(toB), toB?.text);
  });

  await r.step("X-04", "a note with a link waits for the writer", async () => {
    const n = await callB("noteAsMember", page1.id, `[QA] see https://example.com/${ts}`);
    const held = n.value?.note;
    const pub = await guest(`${API}/entries/${page1.id}/notes?${ts}a`);
    r.check("X-04", "it is held, not shown", n.value?.pending === true && !pub.body.includes(`example.com/${ts}`), {
      pending: n.value?.pending,
    });
    const inbox = (await callA("myInbox")).value ?? [];
    const waiting = inbox.find((x) => x.id === held?.id);
    r.check("X-04b", "A's Notes tab lists it as waiting", waiting?.status === "pending", waiting?.status);
    await callA("moderateNote", held.id, "visible");
    await sleep(1500);
    const after = await guest(`${API}/entries/${page1.id}/notes?${ts}b`);
    r.check("X-04c", "once A lets it through, everyone sees it", after.body.includes(`example.com/${ts}`));
  });

  await r.step("X-05", "reaching into the other member's things by id is refused", async () => {
    const tries = {
      "B deletes A's page": await callB("deleteEntry", page1.id),
      "B edits A's page": await callB("saveEntry", page1.id, { title: "hacked", body: "x", visibility: "public" }),
      "B opens A's page in the Notepad": await callB("myEntry", page1.id),
      "B edits A's reply": await callB("editNote", replyA.id, "hacked"),
      "B deletes A's reply": await callB("deleteNote", replyA.id),
      "B approves notes on A's page": await callB("moderateNote", noteB.id, "hidden"),
    };
    const summary = Object.fromEntries(Object.entries(tries).map(([k, v]) => [k, v.value]));
    const allRefused =
      tries["B deletes A's page"].value?.ok === false &&
      tries["B edits A's page"].value?.ok === false &&
      tries["B opens A's page in the Notepad"].value === null &&
      tries["B edits A's reply"].value?.ok === false &&
      tries["B deletes A's reply"].value?.ok === false &&
      tries["B approves notes on A's page"].value?.ok === false;
    const still = JSON.parse((await guest(`${API}/entries/by/${a.handle}/qa-${ts}-x1?${ts}`)).body);
    r.check(
      "X-05",
      "every attempt is refused and A's page is untouched",
      allRefused && still.title === `[QA] cross ${ts}`,
      summary,
    );
    const own = await callB("deleteNote", noteB.id);
    r.check("X-05b", "B can delete B's own note (and the reply under it goes too)", own.value?.ok === true, own.value);
  });

  await r.step("X-06", "keeping B off A's diary, and letting B back", async () => {
    const n = await callB("noteAsMember", page1.id, `[QA] note to be blocked ${ts}`);
    const ban = await callA("banFromDiary", { noteId: n.value.note.id }, true);
    const again = await callB("noteAsMember", page1.id, `[QA] after the block ${ts}`);
    const shout = await callB("shoutAsMember", `[QA] shout after the block ${ts}`, a.handle);
    r.check(
      "X-06",
      "after the block, B can't leave notes or sign A's guestbook",
      ban.value?.ok && again.value?.ok === false && shout.value?.ok === false,
      {
        note: again.value?.error,
        shout: shout.value?.error,
      },
    );
    const bans = (await callA("myBans")).value ?? [];
    const mine = bans.find((x) => x.label === b.displayName);
    const lift = await callA("liftBan", mine?.id);
    const back = await callB("noteAsMember", page1.id, `[QA] back again ${ts}`);
    r.check("X-06b", "after letting B back, B can write again", lift.value?.ok && back.value?.ok, {
      lifted: lift.value,
      back: back.value?.ok,
    });
  });

  await r.step("X-07", "Messenger: talk, block, unblock", async () => {
    const self = await callA("startChat", [a.handle]);
    r.check("X-07", "starting a chat with yourself is refused clearly", self.value?.ok === false, self.value?.error);
    const chat = (await callA("startChat", [b.handle])).value?.chat;
    const sent = await callA("sendChat", chat.id, `[QA] hi B ${ts}`);
    await sleep(1500);
    const listB = (await callB("myChats")).value ?? [];
    const seen = listB.find((c) => c.id === chat.id);
    r.check(
      "X-07b",
      "B sees the message and an unread count",
      seen?.last?.body === `[QA] hi B ${ts}` && seen.unread >= 1,
      {
        sent: sent.value?.ok,
        unread: seen?.unread,
      },
    );
    await callB("blockMember", a.handle, true);
    const blocked = await callA("sendChat", chat.id, `[QA] after block ${ts}`);
    r.check("X-07c", "after B blocks A, A can't message B", blocked.value?.ok === false, blocked.value?.error);
    await callB("blockMember", a.handle, false);
    const ok = await callA("sendChat", chat.id, `[QA] after unblock ${ts}`);
    r.check("X-07d", "after unblocking, A can message B again", ok.value?.ok === true);
    const peek = await callA("chatHistory", chat.id + 100000);
    r.check(
      "X-07e",
      "a conversation A isn't in can't be read by id",
      Array.isArray(peek.value) && peek.value.length === 0,
      peek.value,
    );
  });

  await r.step("X-08", "reporting a page", async () => {
    const own = await callA("reportAsMember", page1.id, "spam");
    const rep = await callB("reportAsMember", page1.id, "other");
    const twice = await callB("reportAsMember", page1.id, "other");
    const still = await guest(`${API}/entries/by/${a.handle}/qa-${ts}-x1?${ts}r`);
    r.check(
      "X-08",
      "a member can't report their own page; one report doesn't hide a page",
      own.value?.ok === false && rep.value?.ok && still.status === 200,
      {
        own: own.value?.error,
        report: rep.value,
        twice: twice.value,
      },
    );
  });

  await r.step("X-09", "Log off on every device ends the other session", async () => {
    await signIn(B2.page, process.env.B_EMAIL, process.env.B_PASSWORD);
    const before = await me(B.page);
    const idb2 = await discoverActions(B2.page);
    await action(B2.page, idb2, "signOutEverywhere");
    await sleep(1500);
    const after = await me(B.page);
    const tryWrite = await callB("noteAsMember", page1.id, "[QA] from an old session");
    r.check(
      "X-09",
      "the first device is signed out and can't write",
      Boolean(before) && after === null && tryWrite.value?.ok === false,
      {
        before: Boolean(before),
        after,
        write: tryWrite.value?.error,
      },
    );
  });
} finally {
  await r.step("X-90", "clean up", async () => {
    // B signs in again to unsubscribe; A deletes the pages (notes, replies, reactions and reports go with them).
    await signIn(B.page, process.env.B_EMAIL, process.env.B_PASSWORD).catch(() => null);
    idb = await discoverActions(B.page);
    await callB("setSubscribed", a.handle, false);
    for (const id of made) await callA("deleteEntry", id);
    const left = ((await callA("myEntries")).value ?? []).filter((e) => e.title.startsWith("[QA]"));
    r.check("X-90", "[QA] pages deleted and B unsubscribed", left.length === 0, { left: left.length });
  });
  r.info("X-99", "browser problems", [...A.page.problems, ...B.page.problems, ...G.page.problems].slice(0, 15));
  r.save();
  for (const x of [A, B, B2, G]) await x.close();
}
