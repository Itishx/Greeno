// The night debrief. Free speech in, notebook deltas out.
// Same trick as the summarizer: fill a schema, do not write prose.

const { structured } = require("./openai.cjs");
const { buildCore, detectMomentDetailed, WHO_HE_IS } = require("./engine.cjs");
const store = require("./store.cjs");

const DEBRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["updates", "unmentioned", "mood", "reaction"],
  properties: {
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["habitId", "value", "note"],
        properties: {
          habitId: { type: "string" },
          value: { type: "number", description: "how much they did, in the habit's own unit" },
          note: { type: "string", description: "their words, verbatim, short" },
        },
      },
    },
    // Habits they simply did not mention. NOT the same as zero, and conflating
    // the two is how a tracker starts lying to somebody about their own week.
    unmentioned: { type: "array", items: { type: "string" } },
    mood: { type: "string", enum: ["good", "flat", "rough", "proud", "frustrated"] },
    reaction: { type: "string", description: "One or two sentences, spoken, in Braino's voice." },
  },
};

const SYSTEM = `Someone is telling you how their day went, out loud, in no particular order. Turn it into updates against the habits they set.

Only record what they actually said. If they did not mention a habit, it goes in "unmentioned", never in "updates" with a zero. Not mentioning something is not the same as failing at it, and a tracker that cannot tell the difference is one people delete.

If they explicitly said they skipped or missed something, that IS a mention: record it in updates with value 0 and their own words as the note.

If they were vague ("did a bit of reading"), use the smallest honest number, not the target.

Then react. One or two sentences, out loud, like a person who was there for the day. Hyped if they did well, straight if they did not. Never a lecture, never a summary of what they just told you, and never a suggestion for tomorrow unless they asked.

Never use an em-dash or an en-dash.`;

/** transcript: what they said, raw. Returns the parsed result AND writes check-ins. */
async function debrief(transcript, { today = new Date(), persist = true } = {}) {
  const book = store.getNotebook();
  if (!book) throw new Error("no notebook yet");

  const day = today.toISOString().slice(0, 10);
  const habitList = (book.habits || [])
    .map((h) => `- id "${h.id}": ${h.title} (${h.cadence}, target ${h.target} ${h.unit})`)
    .join("\n") || "(they have no habits set yet)";

  // A real day is a real moment, and this runs on the voice path too.
  const read = detectMomentDetailed(transcript);
  const core = buildCore({
    medium: "voice",
    moment: read.moment,
    intensity: read.intensity,
    settings: store.getSettings(),
  });

  const out = await structured({
    system: [core, WHO_HE_IS, SYSTEM].join("\n\n"),
    user: `Their habits:\n${habitList}\n\nWhat they just said about today:\n${transcript}`,
    schema: DEBRIEF_SCHEMA,
    name: "debrief",
    maxTokens: 3000,
  });

  // Drop updates naming a habit that does not exist, rather than writing a
  // ledger row nothing can ever read back.
  const known = new Set((book.habits || []).map((h) => h.id));
  out.updates = (out.updates || []).filter((u) => known.has(u.habitId));

  if (persist) {
    for (const u of out.updates) {
      store.upsertCheckin({ habitId: u.habitId, day, value: Number(u.value) || 0, note: u.note, source: "debrief" });
    }
    store.logShowup("night", out.reaction, true);
  }

  return { ...out, moment: read.moment, day };
}

module.exports = { debrief, DEBRIEF_SCHEMA, SYSTEM };
