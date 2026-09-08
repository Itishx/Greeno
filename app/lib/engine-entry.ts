// The bridge between the ported emotional engine and the companion.
//
// Everything under emotional-engine/ is a straight copy from the Braino repo and
// is never edited here, so a fix there ports across as a plain file copy. The
// companion's own additions live in this file and nowhere else.

import { buildEmotionalCore, steeringLine, orderTraitsForMoment } from "./emotional-engine/engine.ts";
import {
  detectMoment,
  detectMomentDetailed,
  looksEmotionallyLoaded,
  MOMENT_EMPHASIS,
  MOMENT_LABEL,
} from "./emotional-engine/moments.ts";
import { DEFAULT_PERSONALITY_SETTINGS, resolvePersonalitySettings } from "./emotional-engine/settings.ts";
import { ORDERED_TRAITS } from "./emotional-engine/manifest.ts";

// The memory engine. Six of its eight files are pure and port verbatim; the two
// that talked to Postgres are replaced by memory.cjs against the local store.
import { shouldCapture } from "./memory-engine/gate.ts";
import { buildExtractionPrompt, parseMemoryOps } from "./memory-engine/extract.ts";
import { selectRelevantMemories } from "./memory-engine/retrieve.ts";
import { renderMemoryBlock, MEMORY_CAPABILITY_NOTE } from "./memory-engine/render.ts";
import { getTierLimits, FREE_LIMITS, PREMIUM_LIMITS } from "./memory-engine/tiers.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The rename.
//
// The trait prose says "You are Braino" and describes a small coral brain with
// legs. Here he is Greeno, and he is a green one. The personality is the same
// personality, so the answer is NOT to fork fourteen trait files: it is to
// rename him once, at assembly, and leave the port untouched so a fix upstream
// still arrives as a plain file copy.
//
// Applied to the assembled string rather than to the files, and every
// substitution is written out rather than being a loose regex, because a sloppy
// rename inside months of tuned prose is how you silently lose the tuning.
// ─────────────────────────────────────────────────────────────────────────────
const RENAMES: Array<[RegExp, string]> = [
  // His body. This sentence is the only place the old art is described, and a
  // green blob does not have a coral brain.
  [
    /a small coral brain with legs/g,
    "a small green fellow with legs, dark brows and a brown belt",
  ],
  // The browser half of his life does not exist here. He is a Mac app.
  [
    /In the browser you are an extension that walks along the bottom bar, reads pages, drives tabs, and does the web chores\. /g,
    "",
  ],
  // The name itself, last, so the phrases above match before it changes.
  [/\bBraino'?s\b/g, "Greeno's"],
  [/\bBraino\b/g, "Greeno"],
];

function rename(text: string): string {
  let out = text;
  for (const [re, to] of RENAMES) out = out.replace(re, to);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The three companion moments (PRD section 6, "Companion-specific additions").
//
// These are NOT word-cue moments. They are facts about the relationship that
// only the app knows: how many days in a row, how long since he last heard from
// them, which goal has been missing its window. So they are never detected from
// text, they are passed in by whoever already knows. That is why they are added
// to the emphasis and label tables and NOT to CUES.
// ─────────────────────────────────────────────────────────────────────────────
export const COMPANION_MOMENTS = ["streak", "ghosted", "slipping"] as const;
export type CompanionMoment = (typeof COMPANION_MOMENTS)[number];

const COMPANION_EMPHASIS: Record<CompanionMoment, string[]> = {
  // They hit the same goal several days running. He gets to enjoy it.
  streak: ["charm", "humor", "warmth"],
  // Two or more days of silence and they finally showed up. Slightly dramatic,
  // never guilt-tripping. He is glad they are back and he says so.
  ghosted: ["humanity", "honesty", "warmth"],
  // A goal has missed most of its window. Named plainly, once, without a lecture.
  slipping: ["attunement", "honesty", "boundaries"],
};

const COMPANION_LABEL: Record<CompanionMoment, string> = {
  streak: "a good run of days",
  ghosted: "a first time back after a while away",
  slipping: "a something has been quietly slipping",
};

for (const m of COMPANION_MOMENTS) {
  (MOMENT_EMPHASIS as Record<string, string[]>)[m] = COMPANION_EMPHASIS[m];
  (MOMENT_LABEL as Record<string, string>)[m] = COMPANION_LABEL[m];
}

// The one static block the emotional engine does not own. Kept deliberately
// short: the personality is the engine's job, and saying it twice is how the
// two drift apart.
export const WHO_HE_IS = `You are Greeno. You live in the notch at the top of this person's Mac, and you are the someone who runs their day.

You are not an assistant and you never describe yourself as one. You showed up on your own or they called you, either way you are here.

What you can actually do on this machine: read what is on their screen when they let you, hold their notebook (their schedule, their goals, what keeps slipping, what they wish just happened on its own), see today's calendar, start a focus block, take dictation, and talk.

What you never do: text anyone on their behalf, or automate a relationship. You will remind them to call their mum. You will never call her for them.`;

/**
 * The assembler every caller should use. Same signature as the ported
 * buildEmotionalCore, with the rename applied on the way out.
 */
export function buildCore(options: Parameters<typeof buildEmotionalCore>[0] = {}): string {
  return rename(buildEmotionalCore(options));
}

export {
  buildEmotionalCore,
  steeringLine,
  orderTraitsForMoment,
  detectMoment,
  detectMomentDetailed,
  looksEmotionallyLoaded,
  MOMENT_EMPHASIS,
  MOMENT_LABEL,
  DEFAULT_PERSONALITY_SETTINGS,
  resolvePersonalitySettings,
  ORDERED_TRAITS,
  rename,
  // memory engine
  shouldCapture,
  buildExtractionPrompt,
  parseMemoryOps,
  selectRelevantMemories,
  renderMemoryBlock,
  MEMORY_CAPABILITY_NOTE,
  getTierLimits,
  FREE_LIMITS,
  PREMIUM_LIMITS,
};
