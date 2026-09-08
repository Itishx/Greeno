// The two tests that need a real model. They skip cleanly without a key, so the
// suite still runs on a fresh clone, but these are the ones that actually decide
// whether the product works.
const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

// .env, so `npm test` behaves the same as the app.
for (const p of [path.join(__dirname, "..", ".env")]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const live = Boolean(process.env.OPENAI_API_KEY);
const opts = { skip: live ? false : "no OPENAI_API_KEY, set one in .env to run the live tests" };

const store = require("../app/lib/store.cjs");
const nb = require("../app/lib/notebook.cjs");
store.init(fs.mkdtempSync(path.join(os.tmpdir(), "greeno-live-")));

// One real yap, kept as a fixture the moment it was recorded. Add every real
// transcript you collect here: this is the corpus the 99% is measured against.
const YAP = [
  "so i usually get up around eight, coffee, then i have lectures from ten to one most weekdays, tuesday and thursday i have a lab in the afternoon, and evenings i try to work on my startup but honestly i end up scrolling",
  "the gym mostly. i say i will go and then i do not. also reading, i have had the same book open for like a month",
  "mornings before lectures are the only time my head is clear, like nine to ten. the group chat destroys me, and youtube",
  "lofi usually, or this one focus playlist on spotify",
  "i wish my inbox just got sorted before i woke up honestly. and i wish someone reminded me to actually eat lunch",
];

test("the summarizer fills the three sections from a real yap", opts, async () => {
  const { yapToNotebook } = require("../app/lib/yap.cjs");
  const book = await yapToNotebook(YAP, "Asia/Kolkata");

  // Their words, not a tidied-up paraphrase. This is what the read-back approval
  // actually turns on.
  const focusText = JSON.stringify(book.focus).toLowerCase();
  assert.ok(/group chat/.test(focusText), "their own words for the distraction were replaced");

  assert.ok(book.routines.length >= 1, "lectures did not become a routine");
  assert.ok(book.habits.length >= 1, "nothing became a habit");
  assert.ok(book.automations.length >= 1, "what they wished for was dropped");
  assert.ok(book.automations.every((a) => a.status === "wished"), "a wish was marked as armed");

  // Never invent a number they did not say. They named no page count.
  const reading = book.habits.find((h) => /read|book/i.test(h.title));
  if (reading) assert.ok(reading.target <= 5, `invented a target of ${reading.target} ${reading.unit}`);

  // Times are real 24-hour times, not prose.
  for (const r of book.routines) {
    assert.ok(nb.toMinutes(r.start) !== null, `routine "${r.label}" has an unparseable start: ${r.start}`);
    assert.ok(nb.toMinutes(r.end) !== null, `routine "${r.label}" has an unparseable end: ${r.end}`);
  }
  assert.ok(nb.toMinutes(book.startTime) !== null, `startTime is unparseable: ${book.startTime}`);

  // No dash he is told never to use, anywhere in the whole document.
  assert.ok(!/[—–]/.test(JSON.stringify(book)), "the notebook contains an em-dash or en-dash");

  console.log("\n  notebook:", JSON.stringify(book, null, 2).split("\n").length, "lines,",
    book.routines.length, "routines,", book.habits.length, "habits,",
    book.automations.length, "wishes");
});

test("not mentioning a habit is not the same as failing at it", opts, async () => {
  const { debrief } = require("../app/lib/debrief.cjs");

  const book = nb.emptyNotebook("Asia/Kolkata");
  book.habits = [
    { id: "read", title: "Read", cadence: "daily", target: 20, unit: "pages", why: "" },
    { id: "gym", title: "Gym", cadence: "daily", target: 1, unit: "session", why: "" },
    { id: "journal", title: "Journal", cadence: "daily", target: 1, unit: "entry", why: "" },
  ];
  store.saveNotebook(book, { approved: true });

  const out = await debrief("read a bit, skipped the gym entirely", { persist: false });
  const touched = out.updates.map((u) => u.habitId);

  assert.ok(touched.includes("read"), "reading was mentioned and should be an update");
  // They SAID they skipped it. That is a mention, and it belongs in updates at zero.
  assert.ok(touched.includes("gym"), "an explicit skip should be recorded, not dropped");
  // Journal never came up at all. It must never appear as a zero.
  assert.ok(!touched.includes("journal"), "a habit they never mentioned was recorded as a zero");
  assert.ok(out.unmentioned.includes("journal"), "the unmentioned habit was not reported as unmentioned");

  assert.ok(out.reaction && out.reaction.length < 300, "the reaction is a lecture, not a reaction");
  assert.ok(!/[—–]/.test(out.reaction), "the reaction contains a dash he is told never to use");
  console.log("\n  he said:", out.reaction);
});
