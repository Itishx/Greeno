// Emotional Engine — THE HEART.
//
// buildEmotionalCore() is the one function that turns Braino's traits + the current moment +
// the user's settings into the personality half of his system prompt. Everything else in this
// folder is data; this is the assembler.
//
// What it does, in plain terms:
//   1. Take the traits in their default order (manifest.ts).
//   2. If the user is in a specific emotional moment, move the traits that should LEAD to the
//      front and add one steering sentence so the model knows what to prioritize right now.
//   3. Render each trait's prose for this medium + settings (a trait can render "" to opt out,
//      e.g. humor when humor is turned off).
//   4. Join it all into one block.
//
// The context (notes, page, movie, etc.) is added separately by braino-prompt.ts — this function
// is ONLY personality.

import type { ClassId, Moment, PersonalitySettings, ResponseMedium, Trait } from "./types.ts";
import { MOMENT_EMPHASIS, MOMENT_LABEL } from "./moments.ts";
import { DEFAULT_PERSONALITY_SETTINGS } from "./settings.ts";
import { getClassManifest } from "./classes.ts";

export type BuildEmotionalCoreOptions = {
  medium?: ResponseMedium;
  settings?: PersonalitySettings;
  moment?: Moment;
  // How strongly the moment registered (1 mild, 2 clear, 3 severe). Reaches the
  // steering line so a panic attack and a flicker of nerves stop producing the
  // identical prompt. Defaults to 2, which is how every existing caller behaved.
  intensity?: number;
  // Which Braino class is answering (Saburi, Iomi, Telos...). Defaults to the shared "braino"
  // manifest, so every existing caller keeps behaving exactly as before. See classes.ts.
  classId?: ClassId;
  // Explicit trait list, overriding the class manifest. Used by the Emotional Intelligence
  // lab to build the SAME message with one trait removed, so the difference that trait
  // makes is visible side by side. Production callers leave this alone.
  traits?: Trait[];
};

export function buildEmotionalCore(options: BuildEmotionalCoreOptions = {}): string {
  const medium: ResponseMedium = options.medium === "voice" ? "voice" : "text";
  const settings = options.settings || DEFAULT_PERSONALITY_SETTINGS;
  const moment: Moment = options.moment || "neutral";
  const traits = options.traits ?? getClassManifest(options.classId).traits;

  const ordered = orderTraitsForMoment(moment, traits);

  const ctx = { medium, settings, moment };
  const renderedTraits = ordered
    .map((trait) => trait.body(ctx).trim())
    .filter(Boolean);

  const steer = steeringLine(moment, traits, options.intensity ?? 2);
  const parts = steer ? [steer, ...renderedTraits] : renderedTraits;

  return parts.join("\n\n");
}

// The lead order for a moment: MOMENT_EMPHASIS names the priority order, and any trait
// that declares the moment in its own leadsOn is appended if the table forgot it.
//
// Why both: every trait already declared leadsOn and NOTHING read it, so a trait could
// claim to lead on grief while the table disagreed, and the table silently won. Two
// sources of truth, one decorative. Now the table sets the ORDER (which matters, and a
// trait cannot know its own rank against others) and the traits act as a safety net so a
// newly added trait is never silently ignored.
export function leadIdsForMoment(moment: Moment, traits: Trait[]): string[] {
  const fromTable = MOMENT_EMPHASIS[moment] || [];
  const declared = traits.filter((t) => t.leadsOn?.includes(moment)).map((t) => t.id);
  return [...fromTable, ...declared.filter((id) => !fromTable.includes(id))];
}

// Move the traits this moment wants to lead with to the front, preserving the manifest order
// for everything else. Unknown/duplicate ids are ignored safely.
// Exported so the HIL trace can show the real reordering rather than re-deriving it
// (see reasoning/hil-reason). Behavior is unchanged for every existing caller.
export function orderTraitsForMoment(moment: Moment, traits: Trait[]): Trait[] {
  const leadIds = leadIdsForMoment(moment, traits);
  const traitById = Object.fromEntries(traits.map((t) => [t.id, t]));
  if (leadIds.length === 0) return traits;

  const seen = new Set<string>();
  const lead: Trait[] = [];
  for (const id of leadIds) {
    const trait = traitById[id];
    if (trait && !seen.has(id)) {
      lead.push(trait);
      seen.add(id);
    }
  }
  const rest = traits.filter((t) => !seen.has(t.id));
  return [...lead, ...rest];
}

// The single sentence that tells the model what to prioritize right now. This is the whole
// "different responses use different traits" mechanism, in one legible line.
export function steeringLine(moment: Moment, traits: Trait[], intensity = 2): string {
  if (moment === "neutral") return "";
  const leadIds = leadIdsForMoment(moment, traits);
  if (leadIds.length === 0) return "";
  const traitById = Object.fromEntries(traits.map((t) => [t.id, t]));
  const traitNames = leadIds
    .map((id) => traitById[id]?.name?.split(/[—,]/)[0].trim().toLowerCase())
    .filter(Boolean)
    .join(", ");
  // Intensity was measured and then thrown away, so a flicker of nerves and a
  // panic attack produced an identical prompt. At full strength it is said out
  // loud, because the difference between those two is the whole job.
  const severity = intensity >= 3 ? " This is at full strength, so meet it there and do not soften it into something smaller." : "";
  return `Right now the user is in ${MOMENT_LABEL[moment]} moment.${severity} Lead with ${traitNames}; let the rest of who you are stay present but recede. Attune to where they actually are before you respond.`;
}
