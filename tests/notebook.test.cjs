const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const nb = require("../app/lib/notebook.cjs");
const store = require("../app/lib/store.cjs");
const nudge = require("../app/lib/nudge.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greeno-test-"));
store.init(dir);

function seed() {
  store.reset();
  const book = nb.emptyNotebook("Asia/Kolkata");
  book.startTime = "08:30";
  book.habits = [
    { id: "read", title: "Read 20 pages", cadence: "daily", target: 20, unit: "pages" },
    { id: "gym", title: "Gym", cadence: "weekly", target: 3, unit: "sessions" },
    { id: "journal", title: "Journal", cadence: "daily", target: 1, unit: "entry" },
  ];
  book.routines = [{ id: "standup", label: "Standup", days: ["mon", "tue", "wed", "thu", "fri"], start: "11:00", end: "11:15", kind: "fixed" }];
  book.focus.deepWork = [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "11:00" }];
  store.saveNotebook(book, { approved: true });
  return book;
}

test("a weekly habit does not become a daily nag", () => {
  const book = seed();
  const mon = new Date("2026-09-07T10:00:00");
  const tue = new Date("2026-09-08T10:00:00");
  assert.deepStrictEqual(nb.habitsDueToday(book, mon).map((h) => h.id).sort(), ["gym", "journal", "read"]);
  assert.deepStrictEqual(nb.habitsDueToday(book, tue).map((h) => h.id).sort(), ["journal", "read"]);
});

test("HH:MM parsing rejects nonsense instead of guessing", () => {
  assert.strictEqual(nb.toMinutes("09:30"), 570);
  assert.strictEqual(nb.toMinutes("00:00"), 0);
  assert.strictEqual(nb.toMinutes("24:00"), null);
  assert.strictEqual(nb.toMinutes("9:5"), null);
  assert.strictEqual(nb.toMinutes(""), null);
  assert.strictEqual(nb.toMinutes(undefined), null);
});

test("deep work windows are respected by the clock", () => {
  const book = seed();
  assert.strictEqual(nb.inDeepWork(book, new Date("2026-09-08T10:00:00")), true);   // tue 10:00
  assert.strictEqual(nb.inDeepWork(book, new Date("2026-09-08T14:00:00")), false);  // tue 14:00
  assert.strictEqual(nb.inDeepWork(book, new Date("2026-09-06T10:00:00")), false);  // sunday
});

test("progress reads the ledger, not the notebook", () => {
  const book = seed();
  const today = new Date("2026-09-08T21:00:00");
  const day = today.toISOString().slice(0, 10);
  store.upsertCheckin({ habitId: "read", day, value: 12, note: "read a bit" });

  const p = nb.progress(book, store.checkinsSince(30), today);
  const read = p.find((x) => x.id === "read");
  assert.strictEqual(read.done, 12);
  assert.strictEqual(read.pct, 60);
  assert.strictEqual(p.find((x) => x.id === "journal").done, 0);
});

test("one truth per habit per day: a second debrief corrects, it does not double count", () => {
  seed();
  const day = "2026-09-08";
  store.upsertCheckin({ habitId: "read", day, value: 12, note: "a bit" });
  store.upsertCheckin({ habitId: "read", day, value: 20, note: "actually finished it" });
  const rows = store.checkinsForDay(day).filter((c) => c.habitId === "read");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].value, 20);
  assert.strictEqual(rows[0].note, "actually finished it");
});

test("a habit missing most of its window is slipping, one bad day is not", () => {
  const book = seed();
  const today = new Date("2026-09-08T21:00:00");
  // Four of the last five days missed.
  for (const i of [1, 5]) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    store.upsertCheckin({ habitId: "journal", day: d, value: 1, note: "" });
  }
  const slipping = nb.slippingHabits(book, store.checkinsSince(30), today);
  assert.ok(slipping.some((h) => h.id === "journal") === false, "one hit in the window should not slip yet");

  store.reset();
  store.saveNotebook(book, { approved: true });
  const only = new Date(today.getTime() - 1 * 86400000).toISOString().slice(0, 10);
  store.upsertCheckin({ habitId: "journal", day: only, value: 0, note: "missed" });
  const slipping2 = nb.slippingHabits(book, store.checkinsSince(30), today);
  assert.ok(slipping2.some((h) => h.id === "journal"), "four misses in five days should slip");
});

test("three moments means three: the nudge respects its cooldown", () => {
  seed();
  assert.strictEqual(nudge.mayNudge(), true, "with no history he may speak");
  store.logShowup("stuck", "you have been in the group chat a while");
  assert.strictEqual(nudge.mayNudge(), false, "he spoke just now and must stay quiet");
  // Thirty-one minutes later he is allowed again.
  assert.strictEqual(nudge.mayNudge(Date.now() + 31 * 60 * 1000), true);
});

test("a restart does not fire a second morning greet", () => {
  seed();
  const now = new Date();
  assert.strictEqual(store.didToday("morning", now), false);
  store.logShowup("morning", "morning, standup at eleven");
  assert.strictEqual(store.didToday("morning", now), true);
});

test("streaks count consecutive days that actually hit the target", () => {
  seed();
  const today = new Date("2026-09-08T21:00:00");
  for (let i = 0; i < 4; i++) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    store.upsertCheckin({ habitId: "read", day: d, value: 20, note: "" });
  }
  assert.strictEqual(store.streakFor("read", 20, today), 4);
  // A day under target ends it.
  const broke = new Date(today.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  store.upsertCheckin({ habitId: "read", day: broke, value: 3, note: "barely" });
  assert.strictEqual(store.streakFor("read", 20, today), 2);
});

test("the nudge prompt carries today's intention and their own distractions", () => {
  const book = seed();
  book.focus.distractions = ["the group chat", "youtube"];
  store.saveNotebook(book, { approved: true });
  const p = nudge.buildPrompt({ todaysIntention: "the deck", recentSuggestions: [], notebook: book });
  assert.ok(p.includes("today was about: the deck"), "the intention is missing");
  assert.ok(p.includes("the group chat"), "their own distractions are missing");
  assert.ok(p.includes("reply with exactly: SKIP"), "the SKIP gate is missing");
});

test("ids survive a re-summarize", () => {
  const book = nb.ensureIds({ habits: [{ title: "Read 20 pages" }], routines: [{ label: "Standup" }], automations: [] });
  assert.strictEqual(book.habits[0].id, "read_20_pages");
  assert.strictEqual(book.routines[0].id, "standup");
});
