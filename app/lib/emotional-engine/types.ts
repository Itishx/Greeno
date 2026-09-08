// Emotional Engine — shared types.
//
// This file defines the small vocabulary the whole engine is built from. If you only read one
// file to understand the shapes, read this one, then manifest.ts.
//
// There are three core ideas:
//   1. A TRAIT is one quality of Braino (honesty, warmth, humor…). Each lives in traits/*.ts.
//   2. A MOMENT is the emotional situation the user is in right now (heartbreak, celebration…).
//      It decides which traits LEAD the response. See moments.ts.
//   3. PersonalitySettings are user toggles (e.g. dad jokes on/off). See settings.ts.

export type ResponseMedium = "text" | "voice";

// Which Braino CLASS is answering. Each class can carry its own trait set (and eventually its
// own trait prose) instead of sharing one system prompt. "braino" is the original, undifferentiated
// product; the other three are the split announced at launch. See classes.ts.
export type ClassId = "braino" | "saburi" | "iomi" | "telos";

// The emotional situation of the current message. "neutral" = nothing special detected.
export type Moment =
  | "neutral"
  | "grief"        // a loss — death, a pet, something gone for good
  | "heartbreak"   // a breakup / relationship ending
  | "venting"      // they need to be heard, not fixed
  | "anxiety"      // overwhelmed, spiralling, scared about something ahead
  | "celebration"  // a win — shipped, got the job, good news
  | "conflict"     // they're wrong, or explicitly want hard critique
  | "banter"       // playful, casual, joking around
  | "focused_task" // they just want the answer / the code / the thing done
  | "building"     // the builder is shaping Braino himself — ideating, reviewing what's next
  | "crisis";      // safety: self-harm, hopelessness — handle with care, point to real help

export type MomentReading = {
  moment: Moment;
  intensity: 1 | 2 | 3; // 1 = faint cue, 3 = unmistakable
};

// User-facing personality toggles. Defaults live in settings.ts.
export type PersonalitySettings = {
  dadJokes: boolean;                 // when true, Braino sprinkles the occasional lame dad joke
  swearing: boolean;                 // when true, Braino may use the occasional salty word with friends
  humor: "off" | "dry" | "playful";  // overall comedic register
  pushback: "gentle" | "direct";     // how hard he challenges a bad idea
  warmth: "measured" | "warm";       // how openly affectionate he runs
};

// Everything a trait's body() needs to render itself.
export type RenderCtx = {
  medium: ResponseMedium;
  settings: PersonalitySettings;
  moment: Moment;
};

// One quality of Braino, expanded into a real playbook.
export type Trait = {
  id: string;            // stable id, matches the filename (e.g. "attunement")
  name: string;          // human label shown in the manifest
  summary: string;       // one line — what this trait is for
  leadsOn?: Moment[];    // moments where this trait should move to the front
  alwaysOn?: boolean;    // true = identity/guardrails that must never drop out
  // The actual prompt prose. Return "" to omit the trait entirely (e.g. humor when humor:"off").
  body: (ctx: RenderCtx) => string;
};

// Tiny helper so every trait file reads the same way and stays type-checked.
export function defineTrait(trait: Trait): Trait {
  return trait;
}
