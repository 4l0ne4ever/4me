// Messenger on the local stack: one-to-one and groups, the group limit, adding and leaving, BUZZ, unread counts,
// lengths and limits, blocking, suspended members, and live delivery over the WebSocket.
import { browser } from "../e2e/cdp.mjs";
import { action, discoverActions, recorder, sleep } from "../e2e/lib.mjs";
import { adminApi, makeMember, signInUi } from "./lib.mjs";

const r = recorder("local-chat");
const A = await makeMember("ca");
const B = await makeMember("cb");
const C = await makeMember("cc");
const BA = await browser();
const BB = await browser();
const BC = await browser();
await signInUi(BA.page, A);
await signInUi(BB.page, B);
await signInUi(BC.page, C);
const [ia, ib, ic] = [await discoverActions(BA.page), await discoverActions(BB.page), await discoverActions(BC.page)];
const asA = (n, ...x) => action(BA.page, ia, n, ...x);
const asB = (n, ...x) => action(BB.page, ib, n, ...x);
const asC = (n, ...x) => action(BC.page, ic, n, ...x);

try {
  let pair;
  await r.step("C-01", "one-to-one: started once, found again", async () => {
    pair = (await asA("startChat", [B.handle])).value?.chat;
    const again = (await asA("startChat", [B.handle.toUpperCase()])).value?.chat;
    const fromB = (await asB("startChat", [A.handle])).value?.chat;
    const nobody = await asA("startChat", ["no_such_person"]);
    r.check("C-01", "the same two people always share one conversation; unknown names refused", pair && again?.id === pair.id && fromB?.id === pair.id && nobody.value?.ok === false, {
      ids: [pair?.id, again?.id, fromB?.id],
      nobody: nobody.value?.error,
    });
  });

  await r.step("C-02", "messages: lengths, unread, read", async () => {
    const empty = await asA("sendChat", pair.id, "   ");
    const max = await asA("sendChat", pair.id, "x".repeat(1000));
    const over = await asA("sendChat", pair.id, "x".repeat(1001));
    await asA("sendChat", pair.id, "hello B");
    const unread = (await asB("myChats")).value.find((c) => c.id === pair.id)?.unread;
    await asB("readChat", pair.id);
    const after = (await asB("myChats")).value.find((c) => c.id === pair.id)?.unread;
    const own = (await asA("myChats")).value.find((c) => c.id === pair.id)?.unread;
    r.check("C-02", "empty and 1001 chars refused, 1000 fine; B has 2 unread until reading; A's own lines aren't unread for A", empty.value?.ok === false && max.value?.ok && over.value?.ok === false && unread === 2 && after === 0 && own === 0, {
      empty: empty.value?.error,
      over: over.value?.error,
      unread,
      after,
      own,
    });
  });

  await r.step("C-03", "a message arrives live on the other member's open page", async () => {
    // Read the live socket the page itself keeps: watch for the text to show up anywhere on B's desktop.
    await BB.page.goto("http://localhost:3000/", 2500);
    await BB.page.clickText("Messenger", "button, a").catch(() => null);
    await sleep(1500);
    await asA("sendChat", pair.id, "live hello");
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) {
      seen = await BB.page.eval(`document.body.innerText.includes("live hello") || document.title.includes("(")`);
      if (!seen) await sleep(500);
    }
    const taskbar = await BB.page.eval(`[...document.querySelectorAll("button, a")].map(b => b.innerText.trim()).filter(t => /messag|messenger/i.test(t)).slice(0, 3)`);
    r.check("C-03", "B sees the new message (or its unread count) without reloading", seen, { taskbar });
  });

  let group;
  await r.step("C-04", "groups: start, title, the twelve limit, add, leave", async () => {
    group = (await asA("startChat", [B.handle, C.handle], `Night owls`)).value?.chat;
    const hist = (await asB("chatHistory", group.id)).value ?? [];
    const many = [];
    for (let i = 0; i < 11; i++) many.push(await makeMember(`g${i}`));
    // Twelve others plus the one starting it would make thirteen.
    const thirteen = await asA("startChat", many.map((m) => m.handle).concat(B.handle), "too many?");
    const addTooMany = await asA("addToChat", group.id, many.slice(0, 10).map((m) => m.handle));
    const addOne = await asA("addToChat", group.id, [many[0].handle]);
    const addAgain = await asA("addToChat", group.id, [many[0].handle]);
    const leave = await asC("leaveChat", group.id);
    const cRead = (await asC("chatHistory", group.id)).value ?? [];
    const cSend = await asC("sendChat", group.id, "still here?");
    const pairLeave = await asA("leaveChat", pair.id);
    r.check("C-04", "group made with a system line; 13 people refused; adding works once; a leaver can't read or send; a pair can't be left", group?.group === true && hist[0]?.kind === "system" && thirteen.value?.ok === false && addTooMany.value?.ok === false && addOne.value?.ok && addAgain.value?.ok === false && leave.value?.ok && cRead.length === 0 && cSend.value?.ok === false && pairLeave.value?.ok === false, {
      title: group?.title,
      system: hist[0]?.body,
      thirteen: thirteen.value?.error,
      addTooMany: addTooMany.value?.error,
      addAgain: addAgain.value?.error,
      leaverReads: cRead.length,
      leaverSends: cSend.value?.error,
      pairLeave: pairLeave.value?.error,
    });
  });

  await r.step("C-05", "BUZZ limit", async () => {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await asA("buzzChat", pair.id)).value?.ok ?? false);
    r.check("C-05", "six BUZZes in ten minutes, then a polite no", codes.slice(0, 6).every(Boolean) && codes[6] === false, codes);
  });

  await r.step("C-06", "blocking and groups", async () => {
    await asB("blockMember", A.handle, true);
    const newGroup = await asA("startChat", [B.handle, C.handle]);
    const inOld = await asA("sendChat", group.id, "B blocked me but we share a group");
    const pairMsg = await asA("sendChat", pair.id, "hi?");
    const list = (await asB("myChats")).value.find((c) => c.id === pair.id);
    await asB("blockMember", A.handle, false);
    r.check("C-06", "after a block: no new group with them, no pair messages; B's list marks the pair as blocked", newGroup.value?.ok === false && pairMsg.value?.ok === false && list?.blocked === true, {
      newGroup: newGroup.value?.error,
      pair: pairMsg.value?.error,
      listBlocked: list?.blocked,
    });
    r.info("C-06b", "an existing group still carries the blocked person's messages (by design?)", inOld.value?.ok);
  });

  await r.step("C-07", "suspended members can't be reached", async () => {
    const S = await makeMember("csus");
    await adminApi(`/users/${S.id}`, { method: "PATCH", body: { status: "suspended" } });
    const start = await asA("startChat", [S.handle]);
    r.check("C-07", "a suspended member can't be messaged", start.value?.ok === false, start.value?.error);
  });

  await r.step("C-08", "message rate limit", async () => {
    const D = await makeMember("cd");
    const chat = (await asA("startChat", [D.handle])).value.chat;
    let firstNo = null;
    for (let i = 1; i <= 62 && !firstNo; i++) {
      const res = await asA("sendChat", chat.id, `m${i}`);
      if (res.value?.ok === false) firstNo = { at: i, error: res.value.error };
    }
    r.info("C-08", "sending as fast as possible: where the limit starts (60 per 10 minutes, all chats together)", firstNo);
  });
} finally {
  r.info("C-99", "browser problems", [...BA.page.problems, ...BB.page.problems, ...BC.page.problems].slice(0, 10));
  r.save();
  for (const b of [BA, BB, BC]) await b.close();
}
