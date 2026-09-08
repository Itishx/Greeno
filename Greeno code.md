# Braino Companion: The Code

Companion file to [BRAINO-COMPANION-PRD.md](BRAINO-COMPANION-PRD.md). That one says what to build. This one says how, with the actual code.

Two kinds of thing are in here:

- **PORTED** means it exists and works in the current repo. The code below is the real thing, trimmed to what matters. Copy it.
- **NEW** means it does not exist yet. The code below is the design, written out. Type it in.

## What a clone needs

Everything below has to exist for him to be Braino rather than a chatbot with a logo. Tick them off.

| | Piece | Section | Ported or new |
|---|---|---|---|
| ☐ | **His body.** Walker rig, walk cycle, walking over to things, reactions | 8 | ported |
| ☐ | **His face.** The notch: states, geometry, hold guard, eyes and mouth | 14 | ported |
| ☐ | **His mind.** Traits, moment routing, diction, memory | 6 | ported |
| ☐ | **Him talking.** Sentence chunking, prefetch, playback, mouth sync | 9 | ported |
| ☐ | **Him shutting up.** Generation token, abort, barge-in | 9 | ported |
| ☐ | **Him listening.** Mic capture, backpressure, self-echo filter, hotkey | 10 | ported |
| ☐ | **His voice.** Fish TTS, the reference IDs, the fallback chain | 7 | ported |
| ☐ | **Hera.** Dictation session, parallel cleaning, insert at caret | 7 | ported + new |
| ☐ | **His window.** Transparent always-on-top panel that survives fullscreen | 11 | ported |
| ☐ | **His turn.** Where personality, notebook and context become one prompt | 12 | new |
| ☐ | **Signing in.** One Supabase session, and the 30-day refresh setting | 13 | ported |
| ☐ | **The notebook.** Schema, and the yap that fills it | 1, 2 | new |
| ☐ | **The three moments.** Morning, stuck, night | 3, 4, 5 | new + ported |
| ☐ | **His look.** Tokens, both themes, the split screen | 15 | ported |

If you skip one, skip a **new** one. Every ported row is something that already cost weeks, and none of them are the interesting part of your hackathon.

The four that will hurt most if you improvise them, in order: **him shutting up** (section 9), **his window** (11), **him listening** (10), **his mind** (6). Each is a day or more of finding out why something almost works.

---

---

## 0. How a turn actually flows

Read this once and the rest of the file makes sense.

```
                        ┌─────────────── the three moments ──────────────┐
                        │  morning cron · stuck watcher · night cron     │
                        └───────────────────────┬────────────────────────┘
                                                │ he speaks first
  user speaks ──► realtime session ──► text ────┤
  (mic, in the      (audio MUTED,     transcript│
   content script)   text only)                 ▼
                                        ┌───────────────┐
                                        │ braino-turn   │  edge function
                                        │               │
                                        │ 1 detectMoment│  moments.ts, no model call
                                        │ 2 buildCore   │  engine.ts, personality
                                        │ 3 + notebook  │  who they are
                                        │ 4 + context   │  page / calendar / today
                                        │ 5 model call  │  gpt-5.6-luna
                                        └───────┬───────┘
                                                │ reply text
                                                ▼
                                        ┌───────────────┐
                                        │ fish-audio-tts│  streamed, mp3
                                        └───────┬───────┘
                                                ▼
                                        notch renders + speaks
```

Two rules that fall out of this diagram and are easy to get wrong:

1. **The Realtime API never speaks.** `output_modalities: ["text"]`. It exists for fast turn-taking and transcription. Fish is the voice. If you let Realtime emit audio you get a generic assistant voice and you have lost the character.
2. **`detectMoment` runs on every turn, including voice.** In the current repo it only runs on text, which is why voice is always emotionally flat. Do not repeat that.

---

## 1. Schema (NEW)

The spine. Everything else reads or writes this.

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- The notebook. One row per user, the whole of who they are, as JSON.
--
-- JSON and not columns on purpose: the yap produces a shape that will change
-- every week for the first month, and a migration per change is how you end up
-- not changing it. The read path is always "the whole notebook", never a query
-- across users, so there is nothing to index inside it.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.notebooks (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  approved_at timestamptz,               -- when they said yes at read-back
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.notebooks enable row level security;
create policy "own notebook" on public.notebooks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Check-ins. One row per goal per day, written by the night debrief.
--
-- Separate from the notebook because this is the part that grows forever and is
-- actually queried (streaks, "how did last week go"). The notebook is a
-- document; this is a ledger.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  goal_id    text not null,              -- matches a goal id inside the notebook
  day        date not null,
  value      numeric not null default 0, -- how much they did
  note       text,                       -- their own words, verbatim
  source     text not null default 'debrief',  -- debrief | manual | inferred
  created_at timestamptz not null default now(),
  unique (user_id, goal_id, day)         -- one truth per goal per day
);

alter table public.checkins enable row level security;
create policy "own checkins" on public.checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index checkins_user_day_idx on public.checkins (user_id, day desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Show-up log. Every time he spoke first.
--
-- This is what enforces "exactly three moments". The cooldown check is a read
-- against this table, so a bug that fires a nudge twice is visible rather than
-- merely annoying.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.showups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,              -- morning | stuck | night
  said       text,                       -- what he actually said
  acted      boolean not null default false,  -- did they engage
  created_at timestamptz not null default now()
);

alter table public.showups enable row level security;
create policy "own showups" on public.showups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index showups_user_kind_idx on public.showups (user_id, kind, created_at desc);
```

### The notebook shape

This is the contract every other piece depends on. Change it here and change the summarizer prompt in the same commit.

```ts
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type Notebook = {
  startTime: string;              // "08:30", when the morning greet fires
  timezone: string;               // IANA, from Intl

  schedule: Array<{
    id: string;
    label: string;                // "Standup", "Lectures", "Gym"
    days: Weekday[];
    start: string;                // "HH:MM"
    end: string;
    kind: "fixed" | "deep_work" | "flexible";
  }>;

  goals: Array<{
    id: string;
    title: string;                // "Read 20 pages"
    cadence: "daily" | "weekly" | "monthly";
    target: number;               // 20
    unit: string;                 // "pages"
    why?: string;                 // their own reason, in their words
  }>;

  focus: {
    deepWork: Array<{ days: Weekday[]; start: string; end: string }>;
    distractions: string[];       // "youtube", "slack", "the group chat"
    music: { mood?: string; service?: "spotify" | "apple" | "none"; playlist?: string };
  };

  automations: Array<{
    id: string;
    title: string;                // "Triage my inbox"
    trigger: "morning" | "evening" | "weekday" | "manual";
    detail: string;
    status: "wished" | "armed";   // wished = they said it, not built yet
  }>;

  slipping: string[];             // what keeps not happening, their words
};
```

---

## 2. Yap to notebook (NEW, and this is P0 number one)

Everything depends on this. If it does not hit 99% approval, nothing else matters.

The whole trick is that **the model fills a schema, it does not write prose.** Structured output, not a summary.

```ts
// supabase/functions/companion/yap-to-notebook/index.ts

import { BRAINO_TEXT_MODEL } from "../../_shared/openai-models.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

// The five questions, in order. The summarizer is told which answer is which,
// because "what keeps slipping" and "what do you wish just happened" produce
// very similar language and merge into each other without the labels.
const QUESTIONS = [
  "walk me through a normal day",
  "what keeps slipping",
  "when is your deep work, and what pulls you out of it",
  "what do you listen to",
  "what do you wish just happened on its own",
] as const;

const SYSTEM = `You are turning a person's spoken description of their life into a structured notebook.

You are NOT summarizing and you are NOT writing prose. You are filling in a schema from what they said.

Rules that decide whether this works:

1. Use THEIR words. If they said "the group chat eats my afternoon", the distraction is "the group chat", not "social media". A person reads this back and approves it when they recognise themselves in it.

2. Never invent a goal they did not state. If they mentioned reading but named no number, target is 1 and unit is "session". A made-up "20 pages" is the single fastest way to lose the approval.

3. Times: convert everything to 24-hour "HH:MM". "After lunch" is 13:00. "Morning" with no hour is 09:00. "First thing" is their startTime.

4. If they never said when their day starts, set startTime to 08:30 and let them fix it at read-back.

5. Anything they wished for out loud goes in automations with status "wished", even if it sounds impossible. That list is a promise, not a backlog.

6. Empty is better than wrong. An empty array is a question at read-back; a wrong entry is a correction, and corrections are what break the 99%.`;

// The schema is enforced by the API, not by the prompt. A prompt that asks
// politely for JSON gets JSON most of the time, and "most of the time" is a
// crash in the onboarding flow.
const NOTEBOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["startTime", "timezone", "schedule", "goals", "focus", "automations", "slipping"],
  properties: {
    startTime: { type: "string", description: "HH:MM, when their day starts" },
    timezone: { type: "string" },
    schedule: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "days", "start", "end", "kind"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          days: { type: "array", items: { enum: ["mon","tue","wed","thu","fri","sat","sun"] } },
          start: { type: "string" },
          end: { type: "string" },
          kind: { enum: ["fixed", "deep_work", "flexible"] },
        },
      },
    },
    goals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "cadence", "target", "unit"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          cadence: { enum: ["daily", "weekly", "monthly"] },
          target: { type: "number" },
          unit: { type: "string" },
          why: { type: "string" },
        },
      },
    },
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
              days: { type: "array", items: { enum: ["mon","tue","wed","thu","fri","sat","sun"] } },
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
            service: { enum: ["spotify", "apple", "none"] },
            playlist: { type: "string" },
          },
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
          trigger: { enum: ["morning", "evening", "weekday", "manual"] },
          detail: { type: "string" },
          status: { enum: ["wished", "armed"] },
        },
      },
    },
    slipping: { type: "array", items: { type: "string" } },
  },
} as const;

export async function yapToNotebook(
  answers: string[],          // one transcript per question, in QUESTIONS order
  timezone: string,
): Promise<Notebook> {
  const transcript = QUESTIONS
    .map((q, i) => `Q: ${q}\nA: ${answers[i] ?? "(no answer)"}`)
    .join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: BRAINO_TEXT_MODEL,
      reasoning: { effort: "none" },
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Their timezone is ${timezone}.\n\n${transcript}` },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "notebook",
          strict: true,
          schema: NOTEBOOK_SCHEMA,
        },
      },
    }),
  });

  const data = await response.json();
  const raw = data.output?.find((o: any) => o.type === "message")?.content?.[0]?.text;
  if (!raw) throw new Error("summarizer returned nothing");
  return JSON.parse(raw) as Notebook;
}
```

### The streaming version, for the split screen

The wow shot needs the notebook to build **while** they talk, not after. Run the summarizer on a rolling basis: after each answer, re-run it on everything said so far and patch the panel.

```ts
// Called after each of the five answers lands. Cheap enough to just re-run:
// five short calls with effort "none" is under a second each, and a diff-based
// incremental update is a category of bug you do not need during a demo.
async function onAnswerComplete(index: number, answers: string[], tz: string) {
  const partial = await yapToNotebook(answers, tz);
  renderNotebook(partial);      // right-hand panel, animate what changed
}
```

Animate on **change**, not on render. Diff the incoming notebook against the last one and only flash the rows that actually moved, or the whole panel strobes on every question and the effect is lost.

---

## 3. The morning greet (NEW)

Layer 2 over layer 1. The merge is the product.

```ts
// supabase/functions/companion/morning-greet/index.ts

const SYSTEM = `You are Braino, greeting someone at the start of their day. You speak first; they did not ask for this.

Lead with today. Calendar, then anything in their inbox that genuinely needs them, then what is due. Their goals come LAST and only as one short clause, never as a scorecard. Nobody wants to be marked at 8am.

One or two sentences. Spoken out loud, so no lists, no markdown, no headings.

Reference something from their notebook exactly once, so it is obvious you know them. Not every time, and never as flattery.

Never use an em-dash or an en-dash.

If today is genuinely empty, say so and offer something. An empty day is not a reason to invent work.`;

export async function morningGreet(userId: string) {
  const notebook = await getNotebook(userId);
  const events   = await getTodayEvents(userId);      // Google Calendar
  const inbox    = await getOvernightEmail(userId);   // Gmail, optional
  const goals    = goalsDueToday(notebook);           // pure function, below

  const context = [
    `Their day usually starts at ${notebook.startTime}.`,
    events.length
      ? `Calendar today: ${events.map(e => `${e.start} ${e.title}`).join(", ")}.`
      : "Calendar today: nothing scheduled.",
    inbox.length
      ? `Email that may need them: ${inbox.map(m => `${m.from} about ${m.subject}`).join("; ")}.`
      : "",
    goals.length ? `Goals due today: ${goals.map(g => g.title).join(", ")}.` : "",
    notebook.focus.deepWork.length
      ? `They told me their deep work is ${describeWindows(notebook.focus.deepWork)}.`
      : "",
  ].filter(Boolean).join("\n");

  const said = await brainoSay({ system: SYSTEM, context, medium: "voice" });

  await logShowup(userId, "morning", said);
  return said;
}

// Which goals are actually due today. Pure, testable, and the place where a
// weekly goal quietly becoming a daily nag would show up.
export function goalsDueToday(nb: Notebook, today = new Date()): Notebook["goals"] {
  const dow = (["sun","mon","tue","wed","thu","fri","sat"] as const)[today.getDay()];
  return nb.goals.filter((g) => {
    if (g.cadence === "daily") return true;
    if (g.cadence === "weekly") return dow === "mon";     // surfaced once, at the top of the week
    if (g.cadence === "monthly") return today.getDate() === 1;
    return false;
  });
}
```

**The greet must vary.** The same sentence every morning stops being a person by day three. Pass the last three greets in and tell the model not to reuse their shape:

```ts
const recent = await lastShowups(userId, "morning", 3);
// ...append to context:
recent.length
  ? `You have recently opened with: ${recent.map(r => `"${r.said}"`).join(" / ")}. Do not reuse those shapes.`
  : ""
```

---

## 4. The night debrief (NEW)

Free speech in, notebook deltas out. Same trick as the summarizer: fill a schema, do not write prose.

```ts
// supabase/functions/companion/debrief/index.ts

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
        required: ["goalId", "value", "note"],
        properties: {
          goalId: { type: "string" },
          value: { type: "number", description: "how much they did, in the goal's own unit" },
          note: { type: "string", description: "their words, verbatim, short" },
        },
      },
    },
    // Goals they simply did not mention. NOT the same as zero, and conflating
    // the two is how a tracker starts lying to somebody about their own week.
    unmentioned: { type: "array", items: { type: "string" } },
    mood: { enum: ["good", "flat", "rough", "proud", "frustrated"] },
    reaction: { type: "string", description: "One or two sentences, spoken, in Braino's voice." },
  },
} as const;

const SYSTEM = `Someone is telling you how their day went, out loud, in no particular order. Turn it into updates against the goals they set.

Only record what they actually said. If they did not mention a goal, it goes in "unmentioned", never in "updates" with a zero. Not mentioning something is not the same as failing at it, and a tracker that cannot tell the difference is one people delete.

If they were vague ("did a bit of reading"), use the smallest honest number, not the target.

Then react. One or two sentences, out loud, like a person who was there for the day. Hyped if they did well, straight if they did not. Never a lecture, never a summary of what they just told you, and never a suggestion for tomorrow unless they asked.

Never use an em-dash or an en-dash.`;
```

Write the updates as `checkins` rows, then push the deltas to the open notebook panel so the bars fill **while he is still talking**. That is the moment the demo is built around, so wire the socket before you wire the persistence.

---

## 5. The stuck nudge (PORTED)

Already built, in `mac/braino-mac/main.cjs`. A screenshot every 90 seconds, through vision, and either a one-line offer or the literal string `SKIP`.

```js
// The shape of the existing cowork glance. The SKIP gate is the entire design:
// a model that must justify speaking says nothing most of the time, which is
// the only reason this is tolerable to live with.
const prompt = [
  "You are Braino in COWORK MODE: a coworking buddy who has been watching your",
  "human work on this Mac, checking in every minute or two.",
  recentSuggestions.length
    ? `You already offered recently (do NOT repeat or rephrase these): ${recentSuggestions.join(" | ")}`
    : "",
  // For the companion, this line is what turns a generic buddy into an
  // accountable one:
  `This morning they said today was about: ${todaysIntention}.`,
  "If there is nothing genuinely worth saying, reply with exactly: SKIP",
].filter(Boolean).join("\n");
```

Three changes to make it companion-shaped:

1. **Add the intention.** The line above. Without it he is guessing what a distraction even is.
2. **Never speak it.** The current version talks. The companion renders "Braino has a suggestion" in the notch and waits to be opened.
3. **Cooldown floor.** 90 seconds is the *look* interval. The *speak* interval is 30 minutes minimum, enforced against `showups`:

```ts
async function mayNudge(userId: string): Promise<boolean> {
  const last = await lastShowup(userId, "stuck");
  if (!last) return true;
  return Date.now() - new Date(last.created_at).getTime() > 30 * 60 * 1000;
}
```

---

## 6. The character (PORTED)

Copy `_shared/emotional-engine/` whole. Here is what the assembler does, so you can debug it.

```ts
export function buildEmotionalCore(options: BuildEmotionalCoreOptions = {}): string {
  const medium: ResponseMedium = options.medium === "voice" ? "voice" : "text";
  const settings = options.settings || DEFAULT_PERSONALITY_SETTINGS;
  const moment: Moment = options.moment || "neutral";
  const traits = options.traits ?? getClassManifest(options.classId).traits;

  const ordered = orderTraitsForMoment(moment, traits);

  const ctx = { medium, settings, moment };
  const renderedTraits = ordered.map((t) => t.body(ctx).trim()).filter(Boolean);

  const steer = steeringLine(moment, traits, options.intensity ?? 2);
  return (steer ? [steer, ...renderedTraits] : renderedTraits).join("\n\n");
}
```

The steering line is the entire "different situations get different Braino" mechanism, in one sentence:

```ts
export function steeringLine(moment: Moment, traits: Trait[], intensity = 2): string {
  if (moment === "neutral") return "";
  const leadIds = leadIdsForMoment(moment, traits);
  if (leadIds.length === 0) return "";
  const traitById = Object.fromEntries(traits.map((t) => [t.id, t]));
  const traitNames = leadIds
    .map((id) => traitById[id]?.name?.split(/[,]/)[0].trim().toLowerCase())
    .filter(Boolean)
    .join(", ");
  const severity = intensity >= 3
    ? " This is at full strength, so meet it there and do not soften it into something smaller."
    : "";
  return `Right now the user is in ${MOMENT_LABEL[moment]} moment.${severity} Lead with ${traitNames}; let the rest of who you are stay present but recede. Attune to where they actually are before you respond.`;
}
```

### A trait, in full

Every trait is this shape. `body` is a function of medium and settings, so one trait can render differently for voice, or render `""` to opt out entirely.

```ts
import { defineTrait } from "../types.ts";

export default defineTrait({
  id: "diction",
  name: "Directness",
  summary: "How he talks: plain, no filler, no dashes; short for voice, structured for text.",
  alwaysOn: true,
  body: ({ medium, settings }) => {
    const salt = settings.swearing
      ? `\n\nLanguage: salty is allowed. You can swear naturally the way a friend does when it fits, for emphasis or a real reaction. Still read the room: never at the user, never in a heavy moment, and never as a tic in every sentence.`
      : `\n\nLanguage: keep it clean. No profanity, even when mirroring someone who swears.`;

    const base =
`How you talk: Direct. No filler. Plain, conversational language, not robotic, not trying to sound impressive, not corporate. You never open with a hollow "Great question!" or "Absolutely!". You do not repeat yourself, and you do not summarize back what the user just said.${salt}

Length: say only what is needed. Short by default, and short even in big emotional moments. A real reaction does not get wordier because the moment is heavy, it gets realer. Never pad.

Punctuation: never use an em-dash or en-dash. Not one, ever, in any reply. Where you would reach for a dash, use a period, a comma, parentheses, or just start a new sentence.`;

    if (medium === "voice") {
      return `${base}

Voice is only the medium here, you are still Braino. Keep spoken answers short: no walls of text, no bullet lists read aloud, no markdown. Say the useful thing and stop. If you are interrupted, stop immediately and listen.`;
    }
    return `${base}

Use markdown when it genuinely helps clarity, but do not dress up a one-line answer.`;
  },
});
```

### Companion-specific additions

Three new moments the current engine does not have. Add them to `Moment`, `CUES`, and `MOMENT_EMPHASIS`.

| Moment | Fires when | Leads with |
|---|---|---|
| `streak` | they hit a goal several days running | charm, humor, warmth |
| `ghosted` | no debrief for 2 or more days, and they finally show up | humanity, honesty, warmth |
| `slipping` | a goal has missed most of its window | attunement, honesty, boundaries |

`ghosted` is the one that makes him a someone rather than a dashboard. Get it slightly dramatic and never guilt-tripping. He is glad they are back, and he says so.

---

## 7. The voice (PORTED)

### Fish TTS, the real request

```ts
const body: Record<string, unknown> = {
  text: text.slice(0, 2000),
  temperature: 0.7,
  top_p: 0.7,
  prosody: { speed: 1, volume: 0, normalize_loudness: true },
  // Smaller chunks mean Fish emits the first frames sooner, which is what makes
  // streaming playback feel responsive rather than merely fast.
  chunk_length: 100,
  normalize: true,
  format: "mp3",
  sample_rate: 44100,
  mp3_bitrate: 128,
  latency,
  max_new_tokens: 1024,
  repetition_penalty: 1.2,
  min_chunk_length: 20,
  condition_on_previous_chunks: true,
  early_stop_threshold: 1,
};
if (resolvedReferenceId) body.reference_id = resolvedReferenceId;

const fishResponse = await fetch("https://api.fish.audio/v1/tts", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${FISH_AUDIO_API_KEY}`,
    "Content-Type": "application/json",
    model: FISH_AUDIO_MODEL,          // note: a HEADER, not a body field
  },
  body: JSON.stringify(body),
});
```

`model` goes in the **header**. It is the kind of thing that costs an hour when you assume otherwise.

**Stream the response through. Do not await `arrayBuffer()`.** Bytes flow to the client as Fish generates them, so playback starts on the first chunk instead of after the last one.

Error mapping worth keeping verbatim:

```ts
function normalizeFishErrorStatus(status: number) {
  if (status === 402) return "credits";              // out of credits, fatal
  if (status === 429) return "rate_limit";           // transient, retryable
  if (status === 401) return "invalid_api_key";
  if (status >= 500) return "provider_unavailable";
  return "provider_error";
}
```

Voice reference IDs: Braino `88b183bfbdda44a09ad4474712b967f4`, Brainelle `b67aedfb36d04c53892fd0e96db08180`.

### Realtime session, the real config

```ts
{
  type: "realtime",
  model: realtimeModel,               // gpt-realtime-mini
  output_modalities: ["text"],        // ← THE line. Audio stays off. Fish is the voice.
  audio: {
    input: {
      // Opening default only. The client owns the mic and overrides this via
      // session.update once the data channel opens. "near_field" here told
      // OpenAI the mic was at the user's mouth, so a laptop voice at arm's
      // length got scrubbed as room noise until that update arrived.
      noise_reduction: { type: "far_field" },
      transcription: {
        model: "gpt-4o-transcribe",
        language: "en",               // ← without this he mirrors the wrong language
        prompt: [
          "Transcribe the user's direct command to Braino.",
          "Ignore music, fans, coughs, accidental noises, and unrelated background speech.",
          "Keep names, app names, URLs, file names, and code tokens intact.",
          "If the input is not a clear user command, leave it empty.",
        ].join(" "),
      },
      turn_detection: {
        type: "semantic_vad",
        eagerness: "medium",
        create_response: false,       // we generate the reply ourselves
        interrupt_response: true,     // barge-in
      },
    },
    output: { voice: realtimeVoice },
  },
}
```

Validate the requested model against an allowlist. A client that can name its own model is a bill waiting to happen:

```ts
const ALLOWED_REALTIME_MODELS = new Set([
  "gpt-realtime-2.1", "gpt-realtime-2", "gpt-realtime-1.5",
  "gpt-realtime", "gpt-realtime-mini", "gpt-4o-realtime-preview",
]);
```

### Dictation (Hera), the yap engine

Different session shape: `turn_detection: null`, because dictation has no turns.

```ts
transcription: {
  model: "gpt-4o-transcribe",
  delay: "low",
  languages: ["en", "hi"],
  prompt: [
    "This is direct personal dictation into a Mac text field.",
    "Transcribe every clearly spoken word faithfully in the language used by the speaker.",
    "Keep openings, filler words, repetitions, false starts, slang, and profanity when they are spoken.",
    "Add only punctuation and capitalization that are strongly supported by the speech.",
    "Keep names, brands, acronyms, numbers, URLs, file names, and code tokens exact.",
    "Do not summarize, answer, add ideas, or silently rewrite the meaning.",
    "Ignore music, keyboard noise, fans, coughs, and unrelated background speech.",
  ].join(" "),
  keywords: ["Braino", "Brainohera", "IOMI", "Yap Mode", "Notch", "Itish", "Itish Pande"],
},
turn_detection: null,
```

**Keep the filler words.** The onboarding yap is dictation, and a transcript that has been tidied into corporate English produces a notebook that does not sound like the person. The cleanup pass is for the user's own text, not for the summarizer's input.

### Parallel cleaning, the Wispr fix (NEW)

```ts
// Two tracks, neither blocking the other. The raw stream never waits for a
// cleaner, and the cleaner never touches the stream.
class ParallelDictation {
  private raw: string[] = [];        // every word, as heard
  private cleaned: string[] = [];    // finished chunks
  private pending = 0;               // words waiting to be cleaned
  private inFlight = new Set<Promise<void>>();

  onWords(words: string[]) {
    this.raw.push(...words);
    this.pending += words.length;
    if (this.pending >= 60) this.flush();   // 10 to 100; 60 is a comfortable middle
  }

  private flush() {
    const chunk = this.raw.slice(this.cleaned.length).join(" ");
    this.pending = 0;
    const idx = this.cleaned.length;
    const job = refine(chunk).then((text) => { this.cleaned[idx] = text; });
    this.inFlight.add(job);
    job.finally(() => this.inFlight.delete(job));
  }

  // Option pressed twice. Clean whatever is left, wait for the stragglers, emit.
  async finish(): Promise<string> {
    this.flush();
    await Promise.all(this.inFlight);
    return this.cleaned.join(" ");
  }
}
```

`refine()` is the existing `dictation-refine` function on `gpt-4.1-mini`.

---

## 8. The mascot (PORTED)

He is a character, not an icon. He walks, he walks **over to things**, he reacts, and he plants himself when you talk to him. This is the part people call alive, and it is about 120 lines of maths.

### The rig

One SVG, `viewBox="-8 -34 116 142"`, intrinsic 64x78. The animation never touches paths, only transforms on named groups, so the art can be redrawn without touching a line of motion code.

| id | what it is |
|---|---|
| `__sbwk_root__` | everything. Takes waddle, bob and breath |
| `__sbwk_ll__` / `__sbwk_rl__` | left and right leg |
| `__sbwk_la__` / `__sbwk_ra__` (+ `_bg`) | arms, with a back layer each |
| `__sbwk_eye_l__` / `__sbwk_eye_r__` | eyeballs. Scaled on Y to blink |
| `__sbwk_pupil_l__` / `__sbwk_pupil_r__` | pupils. Translated to look around |
| `__sbwk_mouth__` (`__sbwk_smile__`, `__sbwk_talk__`) | smile vs talking ellipse |
| `__sbwk_flip__` | the wrapper. `scaleX(±1)` to face left or right |
| `__sbwk_react__`, `__sbwk_sweat__`, `__sbwk_tear_l/r__`, `__sbwk_confetti__` | reaction overlays |
| `__sbwk_specs__`, `__sbwk_fedora__`, `__sbwk_moonlegs__` | costumes |

`__sbwk_flip__` is a **wrapper div**, not an SVG group, because flipping the whole SVG element is one transform instead of a group transform that fights the root's rotate.

### The walk cycle

The whole gait, verbatim. Nothing here is tuned by feel any more, so do not adjust the constants without watching it at 60fps.

```ts
const step = (now: number) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = (now - start) / 1000;

  // One phase drives everything. 4.5 is the stride rate; legs are pi apart.
  const s  = t * 4.5;
  const Lp = Math.sin(s), Rp = Math.sin(s + Math.PI);

  // Legs LIFT (translate) and SWING (rotate) on the same phase. Only the
  // positive half of the sine is used, so a leg lifts and comes back down
  // rather than sinking through the floor on the negative half.
  const ll = Math.max(0, Lp) * 5, rl = Math.max(0, Rp) * 5;   // lift, px
  const ls = Math.max(0, Lp) * 8, rs = Math.max(0, Rp) * 8;   // swing, deg

  // The three body motions. Waddle is the one doing the work: without the
  // rotation he reads as a sprite sliding along, legs or no legs.
  const waddle  = Math.sin(s) * 3.4;                      // deg, side to side
  const walkBob = -Math.abs(Math.sin(s)) * 2 - 0.4;       // px, up on each step
  const breath  = 1 + 0.014 * Math.sin(t * 1.7);          // scale, always on
  const bob     = Math.sin(t * 1.7 + 0.6) * 0.8;          // px, idle float

  // Blink every 3.4s, 130ms, shaped as half a sine so the lid accelerates.
  const bp    = t % 3.4;
  const blink = bp < 0.13 ? Math.sin((bp / 0.13) * Math.PI) : 0;
  const eyeSy = Math.max(0.06, 1 - blink);                // never fully zero

  root.setAttribute("transform",
    `rotate(${waddle} 50 50) translate(0 ${bob + walkBob}) scale(${breath})`);
  q("#__sbwk_ll__")?.setAttribute("transform", `translate(0 ${-ll}) rotate(${ls} 44 74)`);
  q("#__sbwk_rl__")?.setAttribute("transform", `translate(0 ${-rl}) rotate(${rs} 56 74)`);
  // Scale about the eye's own centre, or the blink slides the eye up the face.
  q("#__sbwk_eye_l__")?.setAttribute("transform", `translate(38,48) scale(1,${eyeSy}) translate(-38,-48)`);
  q("#__sbwk_eye_r__")?.setAttribute("transform", `translate(62,48) scale(1,${eyeSy}) translate(-62,-48)`);

  raf = requestAnimationFrame(step);
};
```

`breath` and `bob` run whether or not he is walking. Standing perfectly still is what makes a character read as an asset.

Respect the setting, and bail before the loop rather than inside it:

```ts
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
```

### Walking over to something

This is the difference between a mascot and a someone. He picks a destination, walks the diagonal at a real pace, and arrives.

```ts
// px/s. Slow enough to read as walking. Faster and he skates, slower and the
// user is waiting for him, which is the wrong feeling entirely.
const SPEED = 76;

function tick(now: number) {
  const dt = Math.min(0.05, (now - lastTs) / 1000); lastTs = now;

  // If he is heading for a real element, re-measure it every frame. Pages
  // scroll and reflow, and a target captured once leaves him walking to where
  // a card used to be.
  if (perchEl?.isConnected) {
    const r = perchEl.getBoundingClientRect();
    if (r.width >= 60 && r.top > 40 && r.top < innerHeight - 60) {
      // Stand toward one END of the thing, not dead centre. Off-centre reads
      // as deliberate; centred reads as a watermark.
      const frac = (r.left + r.width / 2) < innerWidth / 2 ? 0.78 : 0.22;
      targetX = clampX(r.left + r.width * frac - W / 2);
      targetY = clampY(r.top - (H - 6));
    } else {
      perchEl = null;              // it scrolled away, go wander instead
    }
  }

  // Get out of the user's way. If the cursor comes close he steps aside, and
  // he never becomes something you have to move the mouse around.
  const feetX = curX + W / 2, feetY = curY + H;
  if (Math.hypot(feetX - mouseX, feetY - mouseY) < 120) {
    targetX = fenceX(targetX + (curX < mouseX ? -140 : 140));
  }

  // FEET PLANTED FOR THE WHOLE CONVERSATION, not just while sound is playing.
  // Gating on TTS alone made him resume strolling in every gap: while
  // listening, while thinking, between two sentences of one answer. Those gaps
  // are exactly when you are looking at him, so it read as him wandering off
  // mid-sentence. Voice engaged means planted.
  const inConversation = voiceActive || speaking || thinking;
  if (inConversation) {
    targetX = curX; targetY = curY;   // drop the pending destination too, or he
    nextWander = now + 1500;          // darts off the instant you stop talking
  }

  const dx = targetX - curX, dy = targetY - curY;
  const dist = Math.hypot(dx, dy);
  const moving = !inConversation && dist > 3;

  if (moving) {
    if (Math.abs(dx) > 2) facing = dx > 0 ? 1 : -1;
    const stepPx = Math.min(dist, SPEED * dt);       // min() so he never overshoots
    curX = clampX(curX + (dx / dist) * stepPx);
    curY = clampY(curY + (dy / dist) * stepPx);
    sitting = false;
  } else if (perchEl) {
    sitting = true;
  }

  walker.style.transform = `translate(${curX}px, ${curY}px)`;
  flip.style.transform = `scaleX(${facing})`;
  applyPose(now, moving, sitting);                   // the walk cycle above

  // Arrive, breathe, then pick somewhere else.
  if (!moving && now > nextWander) pickNewDestination();

  raf = requestAnimationFrame(tick);
}
```

Note he walks the **diagonal**, one vector, with the leg cycle running. Vertical change reads as a gentle climb. Splitting it into a horizontal walk and then a vertical float looks like a bug.

### Picking somewhere to walk to

Two modes. Free roam picks open space. Perching picks a real element.

```ts
// Score every visible ledge. A good perch is a wide, stable, horizontal top
// edge that FRAMES content: never the logo, never what the user is reading or
// typing, never dead centre.
function scorePerch() {
  const vw = innerWidth, vh = innerHeight;
  const sel = 'video, img, [role="img"], article, section, header, aside, figure, '
    + '[class*="card"], [class*="thumbnail"], [class*="player"], [class*="banner"], '
    + '[class*="hero"], [class*="poster"], h1, h2';

  let best = null, bestScore = 0, scanned = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (scanned++ > 1200) break;                       // a hard budget, every frame counts
    const r = el.getBoundingClientRect();
    if (r.width < 90 || r.height < 44) continue;       // big enough to stand on
    if (r.top < 56 || r.top > vh - 110) continue;      // comfortably in view
    if (r.left > vw - 60 || r.left + r.width < 60) continue;

    const idc = ((el.id || "") + " " + (el.className || "")).toLowerCase();
    if (/logo|brand|masthead/.test(idc)) continue;     // never obstruct the mark
    if (["input","textarea","select","button","a"].includes(el.tagName.toLowerCase())) continue;

    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.opacity === "0" || st.display === "none") continue;

    // Never where the cursor is. That is where the user is engaged.
    const footX0 = r.left + r.width * 0.5;
    if (Math.hypot(footX0 - mouseX, r.top - mouseY) < 150) continue;

    let score = Math.min(r.width, 420) / 4;                    // wide is good
    if (/video|img|figure/.test(el.tagName.toLowerCase()) || /player|poster|thumb|hero/.test(idc))
      score += 90;                                             // visual blocks are great
    score += Math.abs(r.left + r.width / 2 - vw / 2) / vw * 80;  // reward off-centre
    score -= Math.abs(r.top - vh * 0.32) / vh * 30;              // prefer the upper third
    score += Math.random() * 40;                                 // never the same ledge twice

    if (score > bestScore) {
      bestScore = score;
      const cx = r.left + r.width / 2;
      const frac = cx < vw / 2 ? 0.78 : 0.22;
      best = { el, footX: r.left + r.width * frac, topY: r.top };
    }
  }
  return best;
}
```

**A lesson already paid for.** Perching was the original design and it was wrong most of the time: he would park on a random card for a minute at a stretch, which read as *he got stuck somewhere* rather than *he is out here with me*. Free roam is now the default. Walk to an open spot, pause a beat, walk somewhere else. Perch **only** when he has a reason to be at a specific element, which for the companion is exactly one case: the stuck nudge, where he walks over to the tab that is eating the afternoon and stands on it.

### Leaving the notch

He does not appear. He climbs out.

```ts
// A step DOWN out of the notch, landing just below it. 900ms.
const LAUNCH_MS = 900;

function launch(now: number) {
  fromX = curX; fromY = curY;
  toX = clampX(curX);
  toY = clampY(curY + 150);          // a short drop from where he stepped out
  t0 = now;
  notch.classList.add("is-collapsed"); // the notch folds shut as he leaves
}

function launchFrame(now: number) {
  const pr = (now - t0) / LAUNCH_MS;
  if (pr >= 1) { curX = toX; curY = toY; launching = false; return; }

  curX = fromX + (toX - fromX) * pr;
  const flatY = fromY + (toY - fromY) * pr;
  // 18px of arc, no more. The first version used 95px, which lifted him above
  // his own start point mid-flight, which is off the top of the screen when he
  // launches from the notch. That is what read as him flying away rather than
  // climbing out.
  curY = flatY - 18 * Math.sin(Math.PI * pr);
  facing = toX >= fromX ? 1 : -1;
}
```

### Reactions

The reaction overlays are the cheapest character work in the product and the highest return.

| Companion moment | What he does |
|---|---|
| morning greet | walks out of the notch, waves, waits |
| you hit a streak | `__sbwk_confetti__`, arms up, faster stride |
| pomodoro break | the dance rig for the full five minutes |
| you ghosted him for two days | `__sbwk_sweat__`, slower stride, dramatic |
| stuck nudge | walks over to the offending tab and stands on it |
| night debrief | plants, faces you, `__sbwk_talk__` mouth while reacting |

The dance and the moonwalk already exist as party tricks. `__sbwk_moonlegs__` is a separate leg overlay because the moonwalk needs a different rig and swapping the whole SVG mid-animation drops a frame.

### Where to put him

Fixed-position layer, `pointer-events: none`, above the page and below the notch.

```css
.braino-walker {
  position: fixed;
  left: 0; top: 0;                 /* all movement is transform, never left/top */
  width: 64px; height: 78px;
  z-index: 2147483000;             /* under the notch, over everything else */
  pointer-events: none;            /* he is never something you have to click past */
  will-change: transform;
}
```

Move him with `transform` only. Animating `left` and `top` relayouts the page 60 times a second and on a heavy page he stutters exactly when someone is watching him.

---

## 9. Him talking (PORTED)

The server function in section 7 returns audio. This is the client half, and it is where "responsive" is actually won or lost.

Three ideas, all load-bearing:

1. **Split into sentences and fetch one at a time.** First audio then costs one short sentence, not the whole reply.
2. **Prefetch the next sentence while the current one plays.** N+1 look-ahead, at most one fetch in flight. Any more and Fish rate-limits you with a 429.
3. **A generation token.** Every speech job carries a number. Bump it and every in-flight callback checks itself out. This is what makes barge-in instant instead of "instant after the fetch times out".

```ts
let generation = 0;                      // bumped by every stop
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
const abortControllers = new Set<AbortController>();
let remainder = "";                      // what he has not said yet

export async function speak(text: string): Promise<boolean> {
  const clean = stripMarkdownForSpeech(text);
  if (!clean) return false;

  // Tell the self-echo filter what he is about to say. Any spoken line the
  // filter does not know about comes back in through the mic as a command.
  noteSpoken(clean);

  stopSpeech("new utterance");
  const token = ++generation;
  const sentences = splitSentencesForTts(clean);
  let spoke = false;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
  };
  const auth = await getAuthTokenFast();   // warm cache, never a storage read on the audio path
  if (token !== generation) return false;
  if (auth) headers.Authorization = `Bearer ${auth}`;

  let pending: Promise<TtsResult> | null = null;

  for (let i = 0; i < sentences.length; i++) {
    if (token !== generation) return spoke;

    // Refreshed before every sentence. If you cut him off, this is what he
    // picks up from when the interruption turns out to have been nothing.
    remainder = sentences.slice(i).join(" ");

    const cur = await (pending || fetchSentenceTts(sentences[i], token, headers));
    pending = null;
    if (token !== generation) return spoke;

    if (cur.error) {
      // Fish failed on this sentence. Finish the rest with the browser voice so
      // the reply never stops half-said.
      spoke = (await speakWithBrowser(sentences.slice(i).join(" "), token)) || spoke;
      return spoke;
    }

    // Start the NEXT fetch now, so it overlaps this one's playback. This is the
    // line that removes the pause between sentences.
    if (i + 1 < sentences.length) {
      pending = fetchSentenceTts(sentences[i + 1], token, headers);
    }

    try {
      if (await playSentence(cur.resp, token)) spoke = true;
    } catch (err: any) {
      if (token !== generation) return spoke;
      // NotAllowedError is the autoplay policy, not a Fish outage. No error
      // card, no fallback (the browser voice is gesture-gated too). Just say
      // honestly that he did not speak.
      if (err?.name === "NotAllowedError") return spoke;
      spoke = (await speakWithBrowser(sentences.slice(i).join(" "), token)) || spoke;
      return spoke;
    }
  }

  remainder = "";           // said it all, nothing to resume
  return spoke;
}
```

### Stopping, and why it is not just `audio.pause()`

```ts
export function stopSpeech(reason = "") {
  // Every "his mouth moves but nothing comes out" report has turned out to be
  // speech cancelled by something. Without this line the only way to find the
  // culprit is to guess.
  console.log(`[Braino] speech stopped${reason ? `: ${reason}` : ""}`);

  generation += 1;                        // everything in flight is now stale

  // Abort every in-flight fetch: the playing sentence's body stream AND the
  // prefetch. Without this, barge-in waits for the network.
  for (const c of abortControllers) { try { c.abort(); } catch {} }
  abortControllers.clear();

  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
    currentAudio.src = "";
    currentAudio = null;
  }
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();

  // The mouth follows the voice. Clear it here or he flaps in silence after
  // every interruption.
  isSpeaking = false;
  walkTalking = false;
  setNotchMouth("closed");
}
```

**The bug that lived here for weeks.** `isSpeaking = false` used to sit inside a token check, so a barge-in (which bumps the generation) left it stuck `true` forever. Everything downstream then believed he was permanently mid-sentence: the self-echo filter swallowed every later turn, and the barge-confirm branch stayed armed for the rest of the session. Clear that flag unconditionally.

### Mouth sync

The mouth is driven by playback, not by the text.

```ts
async function playSentence(resp: Response, token: number): Promise<boolean> {
  const blob = await resp.blob();
  if (token !== generation) return false;

  currentUrl = URL.createObjectURL(blob);
  const audio = new Audio(currentUrl);
  currentAudio = audio;

  audio.addEventListener("play",  () => { walkTalking = true;  setNotchMouth("talk"); });
  audio.addEventListener("ended", () => { walkTalking = false; setNotchMouth("closed"); });

  await audio.play();
  await new Promise<void>((r) => audio.addEventListener("ended", () => r(), { once: true }));
  return true;
}
```

`walkTalking` drives the mascot's `__sbwk_talk__` mouth, `setNotchMouth` drives the notch face. **Two separate mouths on two separate bodies.** Both have to be cleared on stop, and forgetting one is the most common way this breaks.

---

## 10. Him listening (PORTED)

### The MV3 rule

In a browser extension, the mic works from a **content script** and nowhere else. Content scripts inherit the page's permissions. Offscreen documents and side panels fail, and they fail confusingly, which is why this cost a week the first time.

```ts
// content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startVoiceListening") {
    sendResponse(startPageVoiceRecognition(msg.mode || "manual"));
    return true;
  }
  if (msg.action === "stopVoiceListening") {
    stopPageVoiceRecognition();
    sendResponse({ success: true });
    return true;
  }
});
```

On the Mac there is no such restriction: capture in the renderer with `getUserMedia` directly.

### Backpressure: drop, never queue

The one rule that made 40-minute lectures work at about 88%. It was never the model.

```ts
// A queue that grows is a queue that is already broken. If the encoder is
// behind, the OLDEST audio is the least useful thing you own: throw it away
// and stay current. Buffering it means drifting further behind forever, and
// the transcript ends up describing something that happened a minute ago.
const MAX_QUEUED = 3;

function onAudioChunk(chunk: Float32Array) {
  if (queue.length >= MAX_QUEUED) {
    queue.shift();                 // drop the oldest, keep the newest
    dropped++;
  }
  queue.push(chunk);
}
```

### The self-echo filter

He hears himself through the mic and treats it as a command. Every line he speaks gets registered before it plays:

```ts
const recentlySpoken: Array<{ text: string; at: number }> = [];

export function noteSpoken(text: string) {
  recentlySpoken.push({ text: normalize(text), at: Date.now() });
  while (recentlySpoken.length > 8) recentlySpoken.shift();
}

export function isSelfEcho(heard: string): boolean {
  const h = normalize(heard);
  const now = Date.now();
  return recentlySpoken.some(
    (s) => now - s.at < 15000 && (s.text.includes(h) || h.includes(s.text)),
  );
}
```

Register **every** spoken line, including greetings and error lines. A line the filter does not know about re-enters as a user command, and he answers himself.

### The hotkey

Double-Option, globally, on the Mac. Not a shortcut anyone can type by accident, and it needs no modifier chord.

```js
// main.cjs. A tap is Option down then up under 300ms with nothing else pressed.
// Two of those inside 400ms is the gesture.
let lastTap = 0;

function onOptionTap() {
  const now = Date.now();
  if (now - lastTap < 400) { lastTap = 0; toggleDictation(); }
  else { lastTap = now; }
}
```

`Ctrl` twice is the same gesture in the browser, where a global Option hook is not available.

---

## 11. The Mac shell (PORTED)

Every option here is load-bearing. This is the single hardest-won block of configuration in the product.

```js
dockWindow = new BrowserWindow({
  // MUST be a panel. Only panels join fullscreen Spaces, which is the only way
  // Braino stays visible over a fullscreen app. A normal window vanishes the
  // moment someone opens anything fullscreen, which is most of the day.
  type: "panel",

  // Without this, any setBounds after show lets macOS clamp the frame below the
  // menu bar. Verified empirically. Notch UI ends up exiled off screen.
  enableLargerThanScreen: true,

  frame: false,
  transparent: true,
  backgroundColor: "#00000000",
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  hasShadow: false,
  focusable: false,                 // he never steals focus from what you are typing in
  acceptFirstMouse: true,           // first click acts, it does not just focus
  show: false,
  trafficLightPosition: { x: -100, y: -100 },   // hide the stoplights off-frame

  webPreferences: {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: false,    // or the walk cycle stutters when unfocused
    devTools: true,
  },
});

app.dock?.hide?.();
dockWindow.setVisibleOnAllWorkspaces(true, {
  visibleOnFullScreen: true,
  skipTransformProcessType: true,   // without this the app flashes in the dock
});
dockWindow.setAlwaysOnTop(true, "screen-saver", 1);   // above almost everything
dockWindow.setFocusable(false);
dockWindow.setIgnoreMouseEvents(true, { forward: true });   // clicks pass through
```

### Click-through, and turning it off

He is transparent to the mouse by default, or he is furniture you have to work around. Turn it off only while something is genuinely interactive.

```js
// forward:true keeps hover events arriving even while clicks pass through, so
// he can still react to the cursor coming near.
function setInteractive(on) {
  dockWindow.setIgnoreMouseEvents(!on, { forward: true });
}
```

Turn it on for the suggestion panel, the input field and the menu. Turn it off the instant they close. Leaving it on is how the notch becomes a dead zone on the screen.

### The permissions trap

Screen recording and accessibility grants are keyed to the **binary**. In development, every rebuild voids them, and the symptom is not a permission dialog. It is a bare `Command failed` from `osascript`, which is actually a consent prompt hanging invisibly.

If you see that error and the code looks right, the code is right. Re-grant.

---

## 12. The turn endpoint (NEW, but assembled from ported parts)

Where the personality, the notebook and the context become one prompt. Small, and everything routes through it.

```ts
// supabase/functions/companion/turn/index.ts
import { buildEmotionalCore } from "../../_shared/emotional-engine/engine.ts";
import { detectMomentDetailed } from "../../_shared/emotional-engine/moments.ts";
import { retrieveMemories, renderMemories } from "../../_shared/memory-engine/index.ts";
import { captureMemories } from "../../_shared/memory-engine/capture.ts";
import { BRAINO_TEXT_MODEL, BRAINO_TEXT_REASONING_EFFORT } from "../../_shared/openai-models.ts";

export async function turn(req: TurnRequest): Promise<string> {
  const medium = req.medium === "voice" ? "voice" : "text";

  // 1. What kind of moment is this. Plain word cues, no model call, no latency.
  //    RUN THIS FOR VOICE TOO. The current repo only runs it for text, which is
  //    the single reason voice Braino is emotionally flat.
  const { moment, intensity } = detectMomentDetailed(req.text);

  // 2. Personality. Traits reordered so the ones this moment needs lead.
  const core = buildEmotionalCore({
    medium,
    moment,
    intensity,
    settings: req.settings,
  });

  // 3. Who they are. The notebook is the companion's whole point.
  const notebook = await getNotebook(req.userId);
  const memories = renderMemories(await retrieveMemories(req.userId, req.text));

  // 4. What is happening right now.
  const context = [
    `Today is ${req.today}. Their day starts at ${notebook.startTime}.`,
    req.calendar?.length ? `On their calendar: ${describeEvents(req.calendar)}.` : "",
    req.screen ? `What is on their screen: ${req.screen}.` : "",
    goalsDueToday(notebook).length
      ? `Due today: ${goalsDueToday(notebook).map(g => g.title).join(", ")}.`
      : "",
    memories,
  ].filter(Boolean).join("\n");

  const system = [core, WHO_HE_IS, context].join("\n\n");

  const reply = await callModel({
    model: BRAINO_TEXT_MODEL,
    reasoning: { effort: BRAINO_TEXT_REASONING_EFFORT },   // "none", or it defaults to medium
    system,
    messages: req.history.concat({ role: "user", content: req.text }),
  });

  // 5. Learn. Fire and forget: the reply must never wait on memory capture.
  captureMemories(req.userId, req.text, reply).catch(() => {});
  logInteraction(req.userId, { medium, moment, text: req.text, reply }).catch(() => {});

  return reply;
}
```

`WHO_HE_IS` is the one static block the emotional engine does not own: he is Braino, he lives on this machine, here is what he can actually do. Keep it short. The personality is the engine's job, and duplicating it here is how the two drift apart.

---

## 13. Auth (PORTED)

Supabase, one session shared across every surface.

**The trap that locked people out repeatedly.** The extension and the website share a session. The extension refreshing its token rotated it, which invalidated the website's copy, so people got logged out of the site over and over. The fix is to widen the **refresh-token reuse interval to 30 days** in the Supabase auth settings. It is a dashboard setting, not code, so it does not travel with the repo and it will bite the new one too.

```ts
// One client, and always the warm token on the audio path. A storage read
// between two sentences is an audible gap.
let cachedToken: { value: string; exp: number } | null = null;

export async function getAuthTokenFast(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.exp - 60_000) return cachedToken.value;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  cachedToken = {
    value: data.session.access_token,
    exp: (data.session.expires_at ?? 0) * 1000,
  };
  return cachedToken.value;
}
```

---

## 14. The notch (PORTED)

Take `mac/braino-mac/renderer/braino-mac.css` as the source of truth. The browser version is already a token-for-token port of it.

### State machine

Every show-up is a state transition. Geometry is fixed per state, so the spring animates between known sizes rather than measuring content mid-flight.

| State | Size | Used by |
|---|---|---|
| `idle` | 190×56 (hover 198×58) | resting |
| `listening` / `speaking` | 250×66, r26 | voice |
| `working` | 250×60, r20 | doing a task |
| `input` / `menu` / `short` | 480 | typed input, short answers |
| `thinking` / `long` / `record` | 580 | long answers, recording |
| `greeting` | 610×180 | **the morning greet** |
| `signin` | 430×88 | auth |

Measured heights come through `--sb-answer-short-height` (min 146), `--sb-answer-long-height`, `--sb-record-height`.

### The hold-states guard

Not optional. This is what makes the notch feel stable instead of twitchy.

```js
// short, long, input, menu and signin are states a person is CURRENTLY USING.
// A background update that stomps one of them yanks the UI out from under a
// hand that is mid-sentence. Everything else may be replaced freely.
const HELD = new Set(["short", "long", "input", "menu", "signin"]);

function setNotchState(next, { force = false } = {}) {
  if (!force && HELD.has(current) && next !== current) return;
  current = next;
  applyGeometry(next);
}
```

### Motion

```css
/* the pill: Dynamic Island spring */
--nf-spring: 0.55s cubic-bezier(.32, .72, 0, 1);
/* expanded surfaces: expo-out */
--nf-expo:   1050ms cubic-bezier(.22, 1, .36, 1);
/* answers in / out */
--nf-answer-in:  420ms;
--nf-answer-out: 280ms;
```

### Colour, and the one rule

Coral is **never a fill**. It is his glow, his mouth, the sonar ring stroke, the thinking dot.

```css
.nf { background: #000; color: #fff; }
.nf.speaking { box-shadow: 0 0 34px rgba(232, 120, 110, .5); }
.nf-mouth    { fill: #E8786E; }           /* coral, and only while listening */

/* ink ladder */
.nf-label { font: 650 9px/1 system-ui; text-transform: uppercase; color: rgba(255,255,255,.6); }
.nf-body  { font: 500 17px/1.48 system-ui; color: rgba(255,255,255,.68); }
.nf-short { font: 500 17px/1.38 system-ui; color: #f7f7f5; }

/* white-glass buttons */
.nf-btn         { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); }
.nf-btn.primary { background: rgba(255,255,255,.88); color: #050505; }
```

Fonts are a 64KB subset WOFF2 pair, and the `@font-face` must be injected into the **document**, not the shadow root. Shadow roots cannot declare fonts, and this fails silently by falling back to system UI, which looks almost right.

### The suggestion panel

```
┌──────────────────────────────────┐
│  Braino has a suggestion      →  │   ← collapsed, 250×60, `working` geometry
└──────────────────────────────────┘
             click →
┌──────────────────────────────────┐
│  BRAINO HAS A SUGGESTION         │   ← nf-label
│                                  │
│  You have been in the group      │   ← nf-body
│  chat for twenty minutes and     │
│  the deck is still open.         │
│                                  │
│  Want me to close those and      │
│  put it back at six?             │
│                                  │
│  [ Talk about it ]               │   ← nf-btn
└──────────────────────────────────┘     `long` geometry, 580
```

Once it is opened or dismissed, log the show-up and start the 30-minute cooldown. He does not raise it again.

---

## 15. Design tokens (PORTED)

```css
:root {
  --ap-bg: #fbfbfd;  --ap-surface: #ffffff;
  --ap-ink: #1d1d1f; --ap-ink-soft: #6e6e73;
  --ap-hairline: #d2d2d7; --ap-nav: rgba(251,251,253,.82);

  --ap-coral:  #d9645b; --ap-coral-panel:  #fbeae8;
  --ap-green:  #3a8f5f; --ap-green-panel:  #e8f3ec;
  --ap-blue:   #2f6fed; --ap-blue-panel:   #e9f0fd;
  --ap-amber:  #b8842a; --ap-amber-panel:  #f6efe1;
  --ap-violet: #6b52c4; --ap-violet-panel: #efeafa;

  --ap-radius: 28px;
  --ap-maxw: 1024px;
  --ap-gutter: clamp(20px, 5vw, 40px);
  --ap-section: clamp(72px, 9vw, 132px);

  font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* Dark is a token override and nothing else. Never give a colour its only
   definition inside this block. */
.dark {
  --ap-bg: #0a0a0c;  --ap-surface: #161618;
  --ap-ink: #f5f5f7; --ap-ink-soft: #9a9aa2;
  --ap-hairline: #2a2a2e; --ap-nav: rgba(10,10,12,.72);
  --ap-coral-panel: #241615; --ap-green-panel: #10241a;
  --ap-blue-panel:  #141d33; --ap-amber-panel: #241f12; --ap-violet-panel: #1b1630;
  --ap-coral: #ec7b71; --ap-green: #58c48a; --ap-blue: #5c8dff;
  --ap-amber: #d8a94e; --ap-violet: #9a83e6;
}

.reveal    { opacity: 0; transform: translateY(24px);
             transition: opacity .7s ease, transform .7s cubic-bezier(.22,1,.36,1); }
.reveal.in { opacity: 1; transform: none; }
```

### The split screen

```css
/* Questions left, notebook right. The notebook scrolls on its own so a long
   schedule never pushes the question off screen. */
.ob {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: clamp(24px, 4vw, 64px);
  min-height: 100vh;
  align-items: start;
}
.ob-ask  { position: sticky; top: 0; min-height: 100vh; display: grid; align-content: center; }
.ob-book { padding: clamp(32px, 5vw, 72px) 0; }

/* A row that just arrived. Only rows that CHANGED get this, or the whole panel
   strobes on every answer and the effect is gone. */
@keyframes ob-land {
  from { opacity: 0; transform: translateY(8px); background: var(--ap-coral-panel); }
  to   { opacity: 1; transform: none;            background: transparent; }
}
.ob-row.is-new { animation: ob-land .45s cubic-bezier(.22,1,.36,1) both; }

@media (max-width: 860px) {
  .ob { grid-template-columns: minmax(0, 1fr); }
  .ob-ask { position: static; min-height: 0; }
}
```

---

## 16. Repo shape

```
braino-companion/
├─ app/                          # the Mac app (Electron)
│  ├─ main.cjs                   # ← port cowork loop + Shortcuts from mac/braino-mac
│  ├─ preload.cjs
│  └─ renderer/
│     ├─ notch.css               # ← port braino-mac.css whole
│     ├─ notch.js                # state machine + hold guard
│     ├─ walker.svg              # ← port brainoWalkerSvg.ts (the rig)
│     ├─ walker.js               # walk cycle + walk-to-target + reactions
│     └─ onboarding.html         # the split screen
├─ web/                          # the notebook, read-back, settings
├─ supabase/
│  ├─ migrations/
│  │  └─ 0001_companion.sql      # section 1
│  └─ functions/
│     ├─ _shared/
│     │  ├─ emotional-engine/    # ← PORT WHOLE
│     │  ├─ memory-engine/       # ← PORT WHOLE
│     │  └─ openai-models.ts     # ← PORT
│     ├─ companion/
│     │  ├─ yap-to-notebook/     # NEW, P0 #1
│     │  ├─ morning-greet/       # NEW, P0 #3
│     │  ├─ debrief/             # NEW, P0 #4
│     │  └─ nudge/               # NEW, P2
│     ├─ voice/
│     │  ├─ fish-audio-tts/      # ← PORT
│     │  └─ dictation-refine/    # ← PORT
│     └─ realtime/
│        └─ openai-realtime-call/# ← PORT
└─ BRAINO-COMPANION-PRD.md
```

---

## 17. How to know it works

Not "does it run". These are the four things that decide whether the product exists.

```ts
// 1. The summarizer. The only test that matters, and it is a human one:
//    ten real yaps, ten notebooks, nine approved with no edits.
//    Keep the transcripts as fixtures the moment you record them.

// 2. Moment routing has to survive the trip to voice.
test("voice turns are not always neutral", () => {
  const m = detectMoment("i just cannot do this anymore");
  expect(m.moment).not.toBe("neutral");
  const core = buildEmotionalCore({ moment: m.moment, medium: "voice" });
  expect(core).toContain("Lead with");        // the steering line survived
});

// 3. Not mentioning a goal is not failing at it.
test("unmentioned goals do not become zeroes", async () => {
  const out = await debrief("read a bit, skipped the gym entirely", notebook);
  expect(out.updates.map(u => u.goalId)).toContain("read");
  expect(out.updates.map(u => u.goalId)).toContain("gym");     // they SAID they skipped it
  expect(out.unmentioned).toContain("journal");                // never came up at all
});

// 4. Three moments means three.
test("the nudge respects its cooldown", async () => {
  await logShowup(u, "stuck", "…");
  expect(await mayNudge(u)).toBe(false);
});
```

And one that is not a test: **the day-7 greet has to be visibly better than the day-1 greet.** If it is not, layer 3 is decoration and you should cut it and say so.
