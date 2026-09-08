// Emotional Engine — personality settings (the toggles).
//
// These are the knobs a user can eventually flip in Braino's settings. For now they have
// sensible defaults; loadPersonalitySettings (see _shared/user-knowledge.ts) reads any saved
// values from the database and falls back to these.
//
// To add a new toggle: add the field to PersonalitySettings in types.ts, give it a default
// here, and read it inside the trait that should respond to it (e.g. humor.ts reads dadJokes).

import type { PersonalitySettings } from "./types.ts";

export const DEFAULT_PERSONALITY_SETTINGS: PersonalitySettings = {
  // Dad jokes are OFF by default — they're a delight in small doses but not everyone's taste,
  // so the user opts in. humor.ts only tells the occasional lame pun when this is true.
  dadJokes: false,
  // Salty language is OFF by default; the user opts in from the dashboard.
  swearing: false,
  // Braino's baseline comedic register. "dry" = subtle, well-timed wit (his natural voice).
  humor: "dry",
  // How hard he challenges a bad idea. "direct" is his default — kind, but he says it.
  pushback: "direct",
  // How openly affectionate he runs. "warm" = genuinely caring without being clingy.
  warmth: "warm",
};

// Merge a partial/unknown settings object (e.g. from the DB or a request) onto the defaults,
// so a missing or malformed field never breaks the engine.
export function resolvePersonalitySettings(
  partial?: Partial<PersonalitySettings> | null,
): PersonalitySettings {
  if (!partial || typeof partial !== "object") return { ...DEFAULT_PERSONALITY_SETTINGS };
  return {
    dadJokes: typeof partial.dadJokes === "boolean" ? partial.dadJokes : DEFAULT_PERSONALITY_SETTINGS.dadJokes,
    swearing: typeof partial.swearing === "boolean" ? partial.swearing : DEFAULT_PERSONALITY_SETTINGS.swearing,
    humor: partial.humor === "off" || partial.humor === "dry" || partial.humor === "playful"
      ? partial.humor
      : DEFAULT_PERSONALITY_SETTINGS.humor,
    pushback: partial.pushback === "gentle" || partial.pushback === "direct"
      ? partial.pushback
      : DEFAULT_PERSONALITY_SETTINGS.pushback,
    warmth: partial.warmth === "measured" || partial.warmth === "warm"
      ? partial.warmth
      : DEFAULT_PERSONALITY_SETTINGS.warmth,
  };
}
