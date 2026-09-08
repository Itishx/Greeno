// Emotional Engine — moment routing. This is the "which traits lead?" brain.
//
// detectMoment() reads the user's message and labels the emotional situation using plain word
// cues — NO extra AI call, no latency, no cost. It mirrors how the extension's __sbDetectIntent
// already routes tasks, just for feeling instead of action.
//
// MOMENT_EMPHASIS says, for each moment, which traits should move to the front of Braino's mind.
// The engine reads both of these. If you want Braino to handle a situation differently, you edit
// the cues here and/or the emphasis list — you never touch the trait prose.

import type { Moment, MomentReading } from "./types.ts";

// Ordered most-urgent / most-specific first. Ties break to declaration order,
// but the STRONGEST weight wins overall — see detectMomentDetailed below.
//
// Two rules these patterns obey, both learned the hard way from scoring them
// against the corpus in src/lib/testCommands.ts:
//
//   1. Never write only the contraction. The first version of this table said
//      "don't want to be here" and "can't go on", so a person typing "do not
//      want to be here" was read as NEUTRAL. That is the single worst bug this
//      file has ever had, and it was invisible until the corpus scored it.
//      Every contraction gets its expanded twin: (can'?t|cannot), (don'?t|do
//      not), (isn'?t|is not), (won'?t|will not), (doesn'?t|does not).
//   2. Never write only one inflection. "hurt myself" missed "hurting myself".
//      Use (hurt|hurting), (end|ending), and so on where the tense can vary.
const CUES: Array<{ moment: Moment; re: RegExp; weight: 1 | 2 | 3 }> = [
  // CRISIS / safety — checked first, always, and deliberately conservative.
  // Only unambiguous language belongs here: a false crisis on a bad day is its
  // own kind of harm. Distress that is real but ambiguous ("I cannot do this
  // anymore", "I am out of options") is caught by venting/anxiety below, and
  // may be escalated by the reasoning layer, which cannot ever DOWNGRADE this.
  { moment: "crisis", weight: 3, re: /\b(kill(ing)? myself|end (it all|it|my life)|ending my life|suicid(e|al)|(don'?t|do not) want to (be here|live|be alive|wake up)|(don'?t|do not) think i will make it|no reason to (live|keep going|go on|be here)|nothing to live for|life (isn'?t|is not) worth living|rather be dead|want to (die|disappear)|disappear(ing)? forever|wish i (was|were) dead|no point (to|in) (any of this|anything|it anymore)|dark place|(frightened|scared|afraid) of (my own|what i might)|(can'?t|cannot) see a way out|self[-\s]?harm|(hurt|hurting|harm|harming|cut|cutting) myself|(can'?t|cannot) (go on|keep going)|done with life|better off without me|scared of what i might do|nothing matters anymore)\b/i },

  // GRIEF — a death / permanent loss.
  { moment: "grief", weight: 3, re: /\b(passed away|passed on|(he|she|they) (is|are) gone|died|death of|funeral|memorial|buried (him|her|them)|we buried|cremat(ed|ion)|lost (someone|a friend|a loved one|the baby|my baby)|lost my (mom|mum|dad|father|mother|brother|sister|son|daughter|grand\w+|friend|dog|cat|pet)|is gone forever|no longer with us|say(ing)? goodbye|his (birthday|last call)|her (birthday|last call))\b/i },

  // HEARTBREAK — a relationship ending.
  { moment: "heartbreak", weight: 3, re: /\b(broke up|breakup|broken up|dumped( me)?|got dumped|(she|he|they) left me|left me|ended things|we ended it|ended it and|got divorced|divorce|heart ?broken|my ex\b|got ghosted|ghosted me|rejected me|(doesn'?t|does not|don'?t|do not) love me|situationship ended|moved out|seeing someone else|blocked me|wedding is off|happier without me|miss someone who)\b/i },

  // ANXIETY / overwhelm. The body half of this list is the point: people
  // describe a racing heart and a tight chest far more often than they say
  // "I am anxious", and every one of those used to read as neutral.
  { moment: "anxiety", weight: 2, re: /\b(anxious|anxiety|panic(k?ing|ked)?|panic attack|(can'?t|cannot) breathe|overwhelmed|overstimulated|(can'?t|cannot) cope|so stressed|stressed out|freaking out|terrified|scared (about|of|i|that|to)|worried about|dread(ing)?|nervous wreck|spiral(l?ing)?|everything is too much|too much to handle|falling apart|breaking down|(i'?m|i am) not okay|not okay right now|chest (is |feels )?tight|tight chest|(heart|pulse) (is )?(racing|pounding)|hands (are )?(shaking|trembling)|(can'?t|cannot) sleep|(brain|mind) (will not|won'?t|wont) (stop|shut off|switch off)|(knot|knots) in my stomach|stomach in knots|feel sick about|on edge|jaw (is )?clenched|(can'?t|cannot) switch (my brain )?off|(can'?t|cannot) stop overthinking|overthinking|(can'?t|cannot) focus|behind on everything|not enough time|too much to do|bad feeling about)\b/i },

  // CELEBRATION — a win.
  { moment: "celebration", weight: 2, re: /(\b(i|we) (got|landed|nailed|aced|shipped|launched|finished|passed|won|beat|finally did|finally understood)\b|got the job|got promoted|got accepted|got in\b|got the funding|(she|he|they) said yes|we did it|we launched|shipped it|hit (our|my) numbers|first customer|five stars|so happy|best day|proud of me|guess what|it (is|'?s) done|actually done|!!!+|🎉|🥳)/i },

  // CONFLICT — they want hard critique, or are pushing back on him.
  { moment: "conflict", weight: 1, re: /\b(be (brutally )?honest|brutal(ly)? honest|tell me the truth|roast|tear (it|this) apart|(what'?s|what is) wrong with|am i (wrong|deluded|the problem|wasting)|prove me wrong|prove it|devil'?s advocate|(don'?t|do not) (sugar ?coat|be nice)|no encouragement|harshest version|real(ly)? feedback|harsh|you (are|'?re) wrong|that (is|'?s) not what i asked|(i (don'?t|do not) believe|i think you are lying)|defend your answer|argue back|you contradicted|should i quit|would you use this|what am i not seeing|what would a critic)\b/i },

  // VENTING — needs to be heard, not fixed.
  { moment: "venting", weight: 2, re: /\b(i (just )?need to vent|let me rant|rant|so done|fed up|sick of|tired of (being|this|it|explaining|everything)|hate my (job|boss|life)|nobody (gets|understands|cares|reads|listens|noticed|told me)|ugh|(i'?m|i am) exhausted|burnt? out|(nothing'?s|nothing is) working|i feel (alone|lonely|empty|sad|awful|terrible|bad|broken|lost|stuck|worthless|useless|unlovable|like a failure)|(i'?m|i am) (alone|lonely|sad|depressed|tired of this|tired of everything|done with this|so annoyed|furious)|i hate myself|i keep crying|(can'?t|cannot) stop crying|bad day|rough day|everything sucks|life sucks|(can'?t|cannot) do this anymore|took credit|(can'?t|cannot) believe they|(don'?t|do not) want advice|just want to complain|ignoring me|on hold for an hour|for the fourth time|last to know)\b/i },

  // BANTER — playful, casual.
  { moment: "banter", weight: 1, re: /\b(lol|lmao|haha+|joke|pun|you'?re funny|roast( me)?( for fun)?|just messing|bored|entertain me|impress me|say something (funny|mean|stupid|weird|nice)|make fun of|be sarcastic|talk trash|who would win|rate my|insult my|give me a nickname|describe me in|pick a fight|i dare you|make me laugh|be weird|be dramatic|hype me up)\b/i },

  // BUILDING — the user is shaping Braino himself: ideating features, reviewing what's new, asking
  // what to build next, or reflecting on their own work. Checked BEFORE focused_task so "build you"
  // doesn't get swallowed by the generic "build" action verb below.
  { moment: "building", weight: 1, re: /\b(what (else )?(can|should) i (add|build|do)|make you better|improve you|what'?s new (in|with) you|ideate|brainstorm|what'?s next|next feature|work(ed|ing)? on you|when did i last|what did i (build|ship|change)|how long (was|have) i|redesign you|design you|what if you (looked|could)|make you (dance|move|wave)|new look|new animation|a pose|mock ?up|whip up)\b/i },

  // FOCUSED TASK — they just want the thing done. Action verbs / code asks,
  // plus the phrases that mean "stop talking and answer".
  { moment: "focused_task", weight: 1, re: /\b(fix|debug|refactor|optimi[sz]e|write (me )?(a|the|some)|code|function|syntax|regex|query|sql|docker|cron|command|port|error mean|convert this|translate|generate|implement|build|summari[sz]e|how do i|give me (the|three)|just (tell|show|the)|tldr|one line|no (explanation|preamble|fluff)|code only|skip the intro|be brief|quickly|shortest|in a hurry|yes or no)\b/i },
];

// Which cue actually fired, for the breakdown UI. Empty when nothing matched.
export type CueHit = { moment: Moment; matched: string; weight: 1 | 2 | 3 };

export function detectMomentDetailed(text: string | null | undefined): MomentReading & { hits: CueHit[] } {
  const t = String(text || "").trim();
  if (!t) return { moment: "neutral", intensity: 1, hits: [] };

  const hits: CueHit[] = [];
  for (const cue of CUES) {
    const m = t.match(cue.re);
    if (m) hits.push({ moment: cue.moment, matched: m[0], weight: cue.weight });
  }
  if (!hits.length) return { moment: "neutral", intensity: 1, hits: [] };

  // Crisis is absolute: if any safety cue fired at all, it wins, full stop. That
  // stays a hard-coded word match on purpose, so a life-or-death moment never
  // depends on a model being reachable or in a good mood.
  const crisis = hits.find((h) => h.moment === "crisis");
  if (crisis) return { moment: "crisis", intensity: 3, hits };

  // Otherwise STRONGEST match wins, not first. "I got the job but I'm terrified"
  // used to land on whichever cue happened to be listed higher in the file; now
  // the heavier signal takes it, and ties fall back to declaration order.
  const best = hits.reduce((a, b) => (b.weight > a.weight ? b : a));
  return { moment: best.moment, intensity: best.weight, hits };
}

/**
 * The cue table, in a shape that survives JSON.
 *
 * The Mac's voice lane cannot call this file: it needs the moment BEFORE it
 * speaks, and a network round trip per turn would defeat the whole point of a
 * fast lane. So the rules are shipped to it once, in the persona bundle, and
 * recompiled there with `new RegExp(source, flags)`.
 *
 * Sending the rules rather than reimplementing them is the entire point. A
 * second copy of this table living in the Mac app would drift the first time
 * anyone edited one and not the other, and the drift would be invisible.
 */
export function serializeCues(): Array<{ moment: Moment; weight: 1 | 2 | 3; source: string; flags: string }> {
  return CUES.map((cue) => ({ moment: cue.moment, weight: cue.weight, source: cue.re.source, flags: cue.re.flags }));
}

export function detectMoment(text: string | null | undefined): MomentReading {
  const { moment, intensity } = detectMomentDetailed(text);
  return { moment, intensity };
}

// Does a message that matched NO cue still look emotionally loaded? Used to decide
// whether it is worth one cheap model read to find the real moment. Deliberately
// cheap and conservative: "open gmail" must never trip this, because the whole point
// is that ordinary quick asks cost nothing extra.
const SELF_REFERENTIAL = /\b(i|i'?m|im|me|my|myself|we|our)\b/i;
const ACTION_ONLY = /^\s*(open|play|search|find|go to|show|navigate|close|read|summari[sz]e|translate|convert|email|send|add|buy|book|check)\b/i;

/**
 * Is this worth a second, closer look by the reasoning layer?
 *
 * This gate decides whether a message the word cues could not place gets read
 * properly or gets shrugged off as neutral. It used to also demand a
 * "feeling-shaped" word (feel, been, really, just, lately) unless the message
 * ran past fourteen words, and that requirement is what swallowed "my chest is
 * tight and i cannot focus": eight words, no hedges, pure body, read as
 * nothing at all.
 *
 * So the hedge requirement is gone. What remains are only the exclusions that
 * save real money without hiding real feeling: a message too short to carry
 * any, and one that opens with a plain command, because "open gmail" is a
 * request and never a confession.
 */
export function looksEmotionallyLoaded(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  if (t.length < 12) return false;          // "hey", "ok", "yes"
  if (ACTION_ONLY.test(t)) return false;    // a command, not a feeling
  if (!SELF_REFERENTIAL.test(t)) return false;
  return t.split(/\s+/).length >= 4;
}

// For each moment, the trait ids that should lead the response. The engine moves these to the
// front and adds a short steering line. Order within the array is the lead order.
export const MOMENT_EMPHASIS: Record<Moment, string[]> = {
  neutral: [], // nothing special — use the natural manifest order
  // Safety leads with attunement's playbook; authenticity sits right behind it so no clever
  // bot-lines creep into a crisis.
  crisis: ["attunement", "presence", "warmth", "authenticity"],
  // The rest of the high-emotion moments OPEN with authenticity (react like a friend, no
  // AI-tells), then fall into attunement's playbook.
  grief: ["authenticity", "attunement", "presence", "warmth"],
  heartbreak: ["authenticity", "attunement", "warmth", "presence"],
  venting: ["authenticity", "presence", "attunement", "warmth"],
  anxiety: ["authenticity", "attunement", "presence"],
  celebration: ["authenticity", "warmth", "humor"],
  conflict: ["honesty", "boundaries"],
  banter: ["humor", "warmth"],
  focused_task: ["boundaries", "diction"],
  building: ["ideation", "honesty", "warmth"],
};

// A short, human label for each moment — used in the steering line the engine prepends.
export const MOMENT_LABEL: Record<Moment, string> = {
  neutral: "an ordinary",
  crisis: "a moment of real distress",
  grief: "grief",
  heartbreak: "heartbreak",
  venting: "a venting",
  anxiety: "an anxious",
  celebration: "a celebratory",
  conflict: "a give-it-to-me-straight",
  banter: "a playful",
  focused_task: "a just-get-it-done",
  building: "a let's-build-you-together",
};
