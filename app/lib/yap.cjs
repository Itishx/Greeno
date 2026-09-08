// Yap to notebook. P0 number one, and the 99% engine everything else consumes.
//
// The whole trick: the model FILLS A SCHEMA, it does not write prose. Structured
// output, not a summary.
//
// The schema is the dashboard's three sections, in the dashboard's own words:
// routines, habits, focus. Naming them the same thing in both places is what
// keeps the read-back legible: the person sees the section fill in as they talk
// about it.

const { structured } = require("./openai.cjs");
const { ensureIds } = require("./notebook.cjs");

// The five questions, in order. The summarizer is told which answer is which,
// because "what keeps slipping" and "what do you wish just happened" produce
// very similar language and merge into each other without the labels.
const QUESTIONS = [
  "walk me through a normal day",
  "what keeps slipping",
  "when is your deep work, and what pulls you out of it",
  "what do you listen to",
  "what do you wish just happened on its own",
];

// Which section each answer mostly feeds. Drives the live highlight on the right
// hand panel: while they answer question three, the focus card is the one lit up.
const QUESTION_SECTION = ["routines", "habits", "focus", "focus", "routines"];

// What he actually says out loud. The question above is the job; this is the wording.
const ASKED = [
  "So. Walk me through a normal day for you. Start wherever your day actually starts.",
  "What keeps slipping? The stuff you mean to do and then somehow do not.",
  "When is your head actually clear enough for real work? And what pulls you out of it?",
  "What do you listen to when you are trying to focus?",
  "Last one. What do you wish just happened on its own, without you having to think about it?",
];

const SYSTEM = `You are turning a person's spoken description of their life into a structured notebook.

You are NOT summarizing and you are NOT writing prose. You are filling in a schema from what they said.

The notebook has three sections and every field belongs to one of them:

ROUTINES: the recurring shape of their day (the "routines" array), plus the things they wish just happened on their own (the "automations" array). An automation is a routine they do not have yet.

HABITS: the things with a target and a cadence, which is what you will hold them to (the "habits" array), plus what keeps slipping (the "slipping" array, in their own words).

FOCUS: when their head is clear, what pulls them out, and what they listen to (the "focus" object).

Rules that decide whether this works:

1. Use THEIR words. If they said "the group chat eats my afternoon", the distraction is "the group chat", not "social media". A person reads this back and approves it when they recognise themselves in it.

2. Never invent a habit they did not state. If they mentioned reading but named no number, target is 1 and unit is "session". A made-up "20 pages" is the single fastest way to lose the approval.

3. A routine is something that already happens at a time. A habit is something they are trying to do a certain amount of. "Lectures at nine" is a routine. "Read more" is a habit. If they described it as already happening on a schedule, it is a routine, not a habit.

4. Times: convert everything to 24-hour "HH:MM". "After lunch" is 13:00. "Morning" with no hour is 09:00. "First thing" is their startTime.

5. If they never said when their day starts, set startTime to 08:30 and let them fix it at read-back.

6. Anything they wished for out loud goes in automations with status "wished", even if it sounds impossible. That list is a promise, not a backlog.

7. Anything they name as slipping is ALSO a habit. If they said the gym keeps slipping, that is them telling you they want to go: put it in habits with the smallest honest target, AND record their own words in slipping. The two lists are the same fact seen twice, one as a target and one as a feeling. A slipping list with no matching habit gives him nothing to hold them to, and the whole night debrief has nothing to write against.

8. Empty is better than wrong. An empty array is a question at read-back; a wrong entry is a correction, and corrections are what break the 99%.

9. Never use an em-dash or an en-dash anywhere in any field.`;

const DAY_ENUM = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// The schema is enforced by the API, not by the prompt. A prompt that asks
// politely for JSON gets JSON most of the time, and "most of the time" is a
// crash in the middle of someone's onboarding.
const NOTEBOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["startTime", "timezone", "routines", "habits", "focus", "automations", "slipping"],
  properties: {
    startTime: { type: "string", description: "HH:MM, when their day starts" },
    timezone: { type: "string" },

    // ── ROUTINES ────────────────────────────────────────────────────────────
    routines: {
      type: "array",
      description: "Recurring blocks that already happen: lectures, standup, gym, commute.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "days", "start", "end", "kind"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          days: { type: "array", items: { type: "string", enum: DAY_ENUM } },
          start: { type: "string" },
          end: { type: "string" },
          kind: { type: "string", enum: ["fixed", "deep_work", "flexible"] },
        },
      },
    },
    automations: {
      type: "array",
      description: "Routines they wish they had. Status is always 'wished' from the yap.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "trigger", "detail", "status"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          trigger: { type: "string", enum: ["morning", "evening", "weekday", "manual"] },
          detail: { type: "string" },
          status: { type: "string", enum: ["wished", "armed"] },
        },
      },
    },

    // ── HABITS ──────────────────────────────────────────────────────────────
    habits: {
      type: "array",
      description: "Things they are trying to do a certain amount of, with a cadence and a target.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "cadence", "target", "unit", "why"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          cadence: { type: "string", enum: ["daily", "weekly", "monthly"] },
          target: { type: "number" },
          unit: { type: "string" },
          why: { type: "string", description: "their own reason in their words, empty string if they gave none" },
        },
      },
    },
    slipping: {
      type: "array",
      description: "What keeps not happening, in their own words.",
      items: { type: "string" },
    },

    // ── FOCUS ───────────────────────────────────────────────────────────────
    focus: {
      type: "object",
      additionalProperties: false,
      required: ["deepWork", "distractions", "music"],
      properties: {
        deepWork: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["days", "start", "end"],
            properties: {
              days: { type: "array", items: { type: "string", enum: DAY_ENUM } },
              start: { type: "string" },
              end: { type: "string" },
            },
          },
        },
        distractions: { type: "array", items: { type: "string" } },
        music: {
          type: "object",
          additionalProperties: false,
          required: ["mood", "service", "playlist"],
          properties: {
            mood: { type: "string" },
            service: { type: "string", enum: ["spotify", "apple", "none"] },
            playlist: { type: "string" },
          },
        },
      },
    },
  },
};

/**
 * answers: one transcript per question, in QUESTIONS order. Sparse is fine: the
 * split screen calls this after every answer with only what it has so far.
 */
async function yapToNotebook(answers, timezone) {
  const transcript = QUESTIONS
    .map((q, i) => `Q: ${q}\nA: ${answers[i] || "(no answer yet)"}`)
    .join("\n\n");

  const book = await structured({
    system: SYSTEM,
    user: `Their timezone is ${timezone}.\n\n${transcript}`,
    schema: NOTEBOOK_SCHEMA,
    name: "notebook",
    maxTokens: 6000,
  });

  book.timezone = book.timezone || timezone;
  return ensureIds(book);
}

// The same five, marked up for the screen. The phrase between asterisks is set
// in italic, which is the only emphasis the display type ever gets. What he SAYS
// is ASKED above, unmarked, because a marker read aloud is just noise.
const ASKED_DISPLAY = [
  "So. Walk me through *a normal day* for you.",
  "What keeps *slipping*?",
  "When is your head *actually clear* enough for real work?",
  "What do you *listen to* when you are trying to focus?",
  "What do you wish *just happened*, without you having to think about it?",
];

module.exports = { yapToNotebook, QUESTIONS, ASKED, ASKED_DISPLAY, QUESTION_SECTION, NOTEBOOK_SCHEMA, SYSTEM };
