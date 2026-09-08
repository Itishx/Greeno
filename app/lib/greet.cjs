// The morning greet. Layer 2 over layer 1, and the merge is the product.

const { complete } = require("./openai.cjs");
const { buildCore, WHO_HE_IS } = require("./engine.cjs");
const { habitsDueToday, describeWindows, routinesToday } = require("./notebook.cjs");
const store = require("./store.cjs");

const SYSTEM = `You are Braino, greeting someone at the start of their day. You speak first; they did not ask for this.

Lead with today. Calendar, then their routines, then anything in their inbox that genuinely needs them. Their habits come LAST and only as one short clause, never as a scorecard. Nobody wants to be marked at 8am.

One or two sentences. Spoken out loud, so no lists, no markdown, no headings.

Reference something from their notebook exactly once, so it is obvious you know them. Not every time, and never as flattery.

Never use an em-dash or an en-dash.

If today is genuinely empty, say so and offer something. An empty day is not a reason to invent work.`;

/**
 * events: [{ start: "11:00", title: "Standup" }] from Google Calendar, may be []
 * inbox:  [{ from, subject }]                    optional, may be []
 */
async function morningGreet({ events = [], inbox = [], today = new Date() } = {}) {
  const book = store.getNotebook();
  if (!book) throw new Error("no notebook yet");

  const due = habitsDueToday(book, today);
  const routines = routinesToday(book, today);

  // The greet must vary. The same sentence every morning stops being a person by
  // day three, so his last three openings go in and he is told not to reuse them.
  const recent = store.lastShowups("morning", 3);
  const ghostedDays = store.daysSinceLastDebrief(today);

  const context = [
    `Their day usually starts at ${book.startTime}.`,
    events.length
      ? `Calendar today: ${events.map((e) => `${e.start} ${e.title}`).join(", ")}.`
      : routines.length
        ? `Nothing on a connected calendar. From their own routines, today usually has: ${routines.map((r) => `${r.start} ${r.label}`).join(", ")}.`
        : "Calendar today: nothing scheduled.",
    inbox.length
      ? `Email that may need them: ${inbox.map((m) => `${m.from} about ${m.subject}`).join("; ")}.`
      : "",
    due.length ? `Habits due today: ${due.map((h) => h.title).join(", ")}.` : "",
    book.focus?.deepWork?.length
      ? `They told me their deep work is ${describeWindows(book.focus.deepWork)}.`
      : "",
    book.slipping?.length ? `What they said keeps slipping: ${book.slipping.join(", ")}.` : "",
    recent.length
      ? `You have recently opened with: ${recent.map((r) => `"${r.said}"`).join(" / ")}. Do not reuse those shapes.`
      : "",
    ghostedDays !== null && ghostedDays >= 2
      ? `You have not heard from them in ${ghostedDays} days. Be glad they are back. Do not guilt them about it.`
      : "",
  ].filter(Boolean).join("\n");

  const moment = ghostedDays !== null && ghostedDays >= 2 ? "ghosted" : "neutral";
  const core = buildCore({ medium: "voice", moment, settings: store.getSettings() });

  const said = await complete({
    system: [core, WHO_HE_IS, SYSTEM].join("\n\n"),
    messages: [{ role: "user", content: context }],
    maxTokens: 400,
  });

  store.logShowup("morning", said);

  // The intention is what the stuck nudge needs to know what a distraction even
  // is, so it is set here, once, by the moment that actually knows.
  store.setMeta("todaysIntention", [
    routines.map((r) => r.label).join(", "),
    due.map((h) => h.title).join(", "),
  ].filter(Boolean).join(" and "));

  return { said, moment, events, due, routines };
}

module.exports = { morningGreet, SYSTEM };
