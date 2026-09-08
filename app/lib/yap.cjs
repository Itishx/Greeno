// Yap to notebook. The engine everything else consumes.
//
// The whole trick: the model FILLS A SCHEMA, it does not write prose.
//
// The questions are segregated by the three sections the product actually is,
// because an earlier set was written for a general companion and then never
// re-cut when this became a tracker with three tabs. That set asked things like
// "what do you wish just happened on its own", which extracts almost nothing a
// tracker can hold, and left the person unsure what kind of answer was wanted.
//
// Two rules learned from that:
//   1. The QUESTION is short enough to answer out loud. The detail lives in a
//      helper line underneath, not in the question.
//   2. Every question shows one example answer, written as a whole spoken
//      sentence. That is what tells someone HOW MUCH to say. A list of chips
//      reads as buttons and makes people hunt for the right one.

const { structured } = require("./openai.cjs");
const { ensureIds } = require("./notebook.cjs");

/**
 * The onboarding, in three parts, in the order the sections appear.
 *
 * Habits first on purpose: it is the most concrete thing to talk about, so it
 * warms someone up, and it is the section that makes the panel fill fastest.
 * mode "choice" is a tap, not speech: asking somebody to say "twenty five
 * minutes on, five off" out loud is worse than two buttons.
 */
const PARTS = [
  {
    section: "habits",
    title: "Habits",
    intro: "Let's start with what you actually do, and what you want to do.",
    steps: [
      {
        id: "habits_current",
        mode: "voice",
        spoken: "What are your habits right now?",
        display: "What are your *habits* right now?",
        helper: "Things you already do. Gym, reading, journalling, a walk. Tell me roughly how often.",
        example: "gym maybe three times a week, and I read most nights",
      },
      {
        id: "habits_wanted",
        mode: "voice",
        spoken: "And which habits do you want to build?",
        display: "Which habits do you want to *build*?",
        helper: "The ones you keep meaning to start. Tell me why if you know, I will keep your words.",
        example: "actually get to the gym, and read before bed instead of scrolling",
      },
    ],
  },
  {
    section: "focus",
    title: "Focus",
    // Explained before it is asked about. "What do you listen to" arriving with
    // no context is what made the old version feel arbitrary.
    intro: "Focus mode is a timer. You say start, I put your music on and count you down.",
    steps: [
      {
        id: "focus_music",
        mode: "voice",
        spoken: "What do you listen to when you work?",
        display: "What do you *listen to* when you work?",
        helper: "An artist, a playlist, or just a vibe. Tell me if it is Spotify or Apple Music.",
        example: "lofi on Spotify, or brown noise when it is really bad",
      },
      {
        id: "focus_pomodoro",
        mode: "choice",
        spoken: "How long should one focus block be?",
        display: "How long is one *focus block*?",
        helper: "You can change this later.",
        choices: [
          { value: "25/5", work: 25, brk: 5, label: "25 / 5", note: "classic" },
          { value: "50/10", work: 50, brk: 10, label: "50 / 10", note: "deep" },
          { value: "90/20", work: 90, brk: 20, label: "90 / 20", note: "long haul" },
        ],
      },
      {
        id: "focus_window",
        mode: "voice",
        spoken: "When do you focus best, and what interrupts you?",
        display: "When do you focus *best*, and what interrupts you?",
        helper: "A rough time window is fine. Name the thing that actually breaks your focus.",
        example: "nine to eleven in the morning, and Slack kills me",
      },
    ],
  },
  {
    section: "routines",
    title: "Routines",
    intro: "Last part. The shape your day already has.",
    steps: [
      {
        id: "routine_day",
        mode: "voice",
        spoken: "What does a normal weekday look like?",
        display: "What does a normal *weekday* look like?",
        helper: "Things that happen at a set time. Classes, standup, commute, gym.",
        example: "lectures ten to one, standup at eleven, gym Tuesday and Thursday",
      },
      {
        id: "routine_goal",
        mode: "voice",
        spoken: "And what are you working towards?",
        display: "What are you *working towards*?",
        helper: "The project or goal behind all this. One line.",
        example: "shipping my startup by December",
      },
    ],
  },
];

// Flat list of the spoken steps, in order. The summarizer sees these labelled,
// because "what you already do" and "what you want to build" produce very
// similar language and merge into each other without the labels.
const STEPS = PARTS.flatMap((p) => p.steps.map((s) => ({ ...s, section: p.section })));
const VOICE_STEPS = STEPS.filter((s) => s.mode === "voice");

const SYSTEM = `You are turning a person's spoken answers into a structured notebook for a habit tracker.

You are NOT summarizing and you are NOT writing prose. You are filling in a schema from what they said.

The notebook has three sections:

HABITS: things they do or want to do a certain amount of. Each one is either something they ALREADY do (state "current") or something they are trying to start (state "building"). The first question is about current habits and the second is about ones they want to build, so use the question labels to decide. "slipping" holds, in their own words, whatever they said keeps not happening.

FOCUS: when their head is clear ("deepWork"), what breaks it ("distractions"), what they listen to ("music"), and how long a focus block should be ("pomodoro").

ROUTINES: things that already happen at a set time ("routines"), and anything they wished happened on its own ("automations").

Rules that decide whether this works:

1. Use THEIR words. If they said "the group chat eats my afternoon", the distraction is "the group chat", not "social media". A person approves this when they recognise themselves in it.

2. NEVER invent a number they did not say. If they said "read more" the target is 1 and the unit is "session". If they said "gym three times a week" the target is 3 and the unit is "sessions". A made-up "20 pages" is the fastest way to lose their approval.

3. A ROUTINE already happens at a time. A HABIT is an amount they are trying to hit. "Lectures at ten" is a routine. "Read more" is a habit. If they described it as already happening on a schedule, it is a routine.

4. Times become 24-hour "HH:MM". "After lunch" is 13:00. "Morning" with no hour is 09:00. "Nine to eleven" is 09:00 to 11:00.

5. If they never said when their day starts, infer it from their earliest routine, otherwise use 08:30, and set startTimeGuessed to true. Set it to false only when they actually told you.

5b. An end time you were not given is a guess. "Standup at eleven" has no end, so end is an empty string. Same for a focus window: if they said "mornings" and named no hour, start and end are empty and "said" carries their phrase.

6. Empty is better than wrong. An empty array is a question at read-back; a wrong entry is a correction, and corrections are what lose the approval.

7. Anything they wished happened by itself goes in automations with status "wished", even if it sounds impossible.

7b. "aim" is the thing they said they are working towards. Their words. If they did not say, both fields are empty strings.

8. Never use an em-dash or an en-dash anywhere in any field.`;

const DAY_ENUM = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const NOTEBOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["startTime", "startTimeGuessed", "timezone", "aim", "routines", "habits", "focus", "automations", "slipping"],
  properties: {
    startTime: { type: "string", description: "HH:MM, when their day starts" },
    // So the read-back can say "I guessed 08:30, fix it here" rather than
    // presenting a default as though they had told us.
    startTimeGuessed: { type: "boolean", description: "true when they never said a wake time and it was defaulted" },
    timezone: { type: "string" },

    // What the last question asks about. Without this the answer was collected
    // and thrown away.
    aim: {
      type: "object",
      additionalProperties: false,
      required: ["title", "detail"],
      properties: {
        title: { type: "string", description: "the one thing they are working towards, their words, empty string if they did not say" },
        detail: { type: "string", description: "any why or deadline they volunteered, empty string if none" },
      },
    },

    habits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "cadence", "target", "unit", "why", "state"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          cadence: { type: "string", enum: ["daily", "weekly", "monthly"] },
          target: { type: "number" },
          unit: { type: "string" },
          why: { type: "string", description: "their own reason, empty string if they gave none" },
          // Separating these is the point of asking two questions instead of
          // one: people describe what they already do accurately and what they
          // intend aspirationally, and a tracker should not treat them alike.
          state: { type: "string", enum: ["current", "building"] },
        },
      },
    },
    slipping: { type: "array", items: { type: "string" } },

    focus: {
      type: "object",
      additionalProperties: false,
      // No pomodoro here on purpose. strict json_schema with
      // additionalProperties:false makes every property required, so asking the
      // model for it would force it to invent two integers from a transcript
      // that never mentions minutes. It comes from the tap and is merged in JS.
      required: ["deepWork", "distractions", "music"],
      properties: {
        deepWork: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["said", "days", "start", "end"],
            properties: {
              // What gets shown back to them is their phrase, not a clock range
              // they never spoke. "mornings before eleven" reads as theirs.
              said: { type: "string", description: "their own phrase for the window, verbatim" },
              days: { type: "array", items: { type: "string", enum: DAY_ENUM } },
              start: { type: "string", description: "HH:MM only if they named the hour, otherwise empty string" },
              end: { type: "string", description: "HH:MM only if they named the hour, otherwise empty string" },
            },
          },
        },
        distractions: { type: "array", items: { type: "string" } },
        music: {
          type: "object",
          additionalProperties: false,
          required: ["mood", "service", "playlist", "tracks"],
          properties: {
            mood: { type: "string" },
            service: { type: "string", enum: ["spotify", "apple", "none"] },
            playlist: { type: "string" },
            // The actual songs and artists, as said. A vibe with no names gives [].
            tracks: { type: "array", items: { type: "string" }, description: "song or artist names exactly as they said them" },
          },
        },
      },
    },

    routines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "days", "start", "end", "kind"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          days: { type: "array", items: { type: "string", enum: DAY_ENUM } },
          start: { type: "string" },
          end: { type: "string", description: "HH:MM only if they said when it ends, otherwise empty string. Never guess a duration." },
          kind: { type: "string", enum: ["fixed", "deep_work", "flexible"] },
        },
      },
    },
    automations: {
      type: "array",
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
  },
};

/**
 * answers: keyed by step id. Sparse is fine, the panel calls this after every
 * answer with only what it has so far.
 * pomodoro: {work, break} from the tap step, applied directly rather than
 * inferred, because a choice is not something to re-derive from speech.
 */
async function yapToNotebook(answers, timezone, pomodoro) {
  const transcript = VOICE_STEPS
    .map((s) => `Q (${s.section}): ${s.spoken}\nA: ${(answers && answers[s.id]) || "(no answer yet)"}`)
    .join("\n\n");

  const book = await structured({
    system: SYSTEM,
    user: `Their timezone is ${timezone}.\n\n${transcript}`,
    schema: NOTEBOOK_SCHEMA,
    name: "notebook",
    maxTokens: 6000,
  });

  book.timezone = book.timezone || timezone;
  book.focus = book.focus || {};
  // The tap wins over anything the model guessed.
  book.focus.pomodoro = {
    work: Number(pomodoro?.work) > 0 ? Number(pomodoro.work) : (book.focus.pomodoro?.work || 25),
    break: Number(pomodoro?.break) > 0 ? Number(pomodoro.break) : (book.focus.pomodoro?.break || 5),
  };
  return ensureIds(book);
}

module.exports = { yapToNotebook, PARTS, STEPS, VOICE_STEPS, NOTEBOOK_SCHEMA, SYSTEM };
