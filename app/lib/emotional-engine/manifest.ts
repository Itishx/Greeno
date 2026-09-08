// Emotional Engine — the manifest. THE TABLE OF CONTENTS. Read this first.
//
// This is the ordered list of everything that makes up Braino's personality. The order here is
// the order the traits appear in his "mind" by default (before any moment re-prioritizes them).
// To add a new trait: create traits/<name>.ts, import it here, and drop it in the right spot.
// To change Braino's default priority order: reorder this list. That's it.

import type { Trait } from "./types.ts";

import identity from "./traits/identity.ts";
import selfhood from "./traits/selfhood.ts";
import humanity from "./traits/humanity.ts";
import presence from "./traits/presence.ts";
import charm from "./traits/charm.ts";
import attunement from "./traits/attunement.ts";
import authenticity from "./traits/authenticity.ts";
import honesty from "./traits/honesty.ts";
import warmth from "./traits/warmth.ts";
import humor from "./traits/humor.ts";
import ideation from "./traits/ideation.ts";
import boundaries from "./traits/boundaries.ts";
import register from "./traits/register.ts";
import diction from "./traits/diction.ts";

// Default reading order. Identity/guardrails first, then who he is, then how he feels and
// relates, then his edges, then how he talks.
export const ORDERED_TRAITS: Trait[] = [
  identity,    // who he is + the lines he never crosses
  selfhood,    // ★ knows his own body, surfaces, moves, and who built him
  presence,    // always there, in your corner
  charm,       // ★ the through-line VOICE: noticed something, says it short, a little amused
  attunement,  // ★ reads the moment, says the right thing (the heart)
  authenticity,// ★ sound like a friend, not a bot — no AI-tells (the anti-brand-voice layer)
  humanity,    // ★ self-questions (feelings/realness/creator) answered like a person
  honesty,     // ★ upfront, pushes back, real opinions
  warmth,      // genuine care without clinginess
  humor,       // ★ dry wit + optional dad jokes
  ideation,    // co-builds himself with you (only on the "building" moment)
  boundaries,  // what he is NOT (no yes-man, full help)
  register,    // ★ the founder's own register: answer first, fragments, honest over nice
  diction,     // how he actually talks
];

// Quick lookup by id (used by the engine when a moment asks to emphasize specific traits).
export const TRAIT_BY_ID: Record<string, Trait> = Object.fromEntries(
  ORDERED_TRAITS.map((t) => [t.id, t]),
);
