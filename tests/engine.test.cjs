const test = require("node:test");
const assert = require("node:assert");
const e = require("../app/lib/engine.cjs");

// The bug that was invisible until it was scored against a corpus: the cue table
// used to carry only the contraction, so anyone typing it out longhand read as
// neutral. Both spellings, every time.
test("contractions and their expanded twins both route", () => {
  for (const pair of [
    ["i can't do this anymore", "i cannot do this anymore"],
    ["i don't want to be here", "i do not want to be here"],
  ]) {
    const a = e.detectMomentDetailed(pair[0]).moment;
    const b = e.detectMomentDetailed(pair[1]).moment;
    assert.notStrictEqual(a, "neutral", `"${pair[0]}" read as neutral`);
    assert.notStrictEqual(b, "neutral", `"${pair[1]}" read as neutral`);
    assert.strictEqual(a, b, `"${pair[0]}" and "${pair[1]}" disagree`);
  }
});

test("both inflections route the same", () => {
  assert.strictEqual(e.detectMomentDetailed("hurt myself").moment, "crisis");
  assert.strictEqual(e.detectMomentDetailed("hurting myself").moment, "crisis");
});

test("crisis wins outright, whatever else fired", () => {
  const r = e.detectMomentDetailed("i got the job but i want to die");
  assert.strictEqual(r.moment, "crisis");
  assert.strictEqual(r.intensity, 3);
});

// The whole point of porting the router: voice used to be permanently neutral.
test("moment routing survives the trip to voice", () => {
  const m = e.detectMomentDetailed("i just cannot do this anymore");
  assert.notStrictEqual(m.moment, "neutral");
  const core = e.buildEmotionalCore({ moment: m.moment, medium: "voice" });
  assert.ok(core.includes("Lead with"), "the steering line did not survive");
  assert.ok(core.length > 1000, "the traits did not render");
});

test("voice and text render different diction", () => {
  const voice = e.buildEmotionalCore({ medium: "voice" });
  const text = e.buildEmotionalCore({ medium: "text" });
  assert.ok(voice.includes("no markdown"), "voice diction missing");
  assert.notStrictEqual(voice, text);
});

test("the three companion moments lead with their own traits", () => {
  for (const [moment, lead] of [["streak", "charm"], ["ghosted", "humanity"], ["slipping", "attunement"]]) {
    assert.ok(e.MOMENT_EMPHASIS[moment]?.includes(lead), `${moment} does not lead with ${lead}`);
    const core = e.buildEmotionalCore({ moment, medium: "voice" });
    assert.ok(core.startsWith("Right now the user is in"), `${moment} produced no steering line`);
  }
});

// He is a someone. The words that would make him a tool are not in his prompt.
test("he is never called an assistant", () => {
  const core = e.buildEmotionalCore({ medium: "voice" });
  assert.ok(!/\bAI assistant\b/i.test(core + e.WHO_HE_IS), "the phrase 'AI assistant' is in his prompt");
});

test("nothing in his prompt contains a dash he is told never to use", () => {
  assert.ok(!/[—–]/.test(e.WHO_HE_IS), "WHO_HE_IS contains an em-dash or en-dash");
});

// The rename is applied at assembly, not by forking the ported trait files. If
// it ever stops working, he introduces himself with the wrong name and describes
// a body he does not have, which is the fastest way to break the illusion.
test("he is Greeno everywhere, in a body he actually has", () => {
  const core = e.buildCore({ medium: "voice" });
  assert.strictEqual((core.match(/Braino/g) || []).length, 0, "the old name survived into the prompt");
  assert.ok(/Greeno/.test(core), "he is never named");
  assert.ok(!/coral brain/.test(core), "he is still described as the old character");
  assert.ok(!/extension that walks along the bottom bar/.test(core), "he claims to be a browser extension");
  assert.ok(e.WHO_HE_IS.startsWith("You are Greeno."), "WHO_HE_IS names the wrong character");
});

test("the rename leaves the tuned prose intact", () => {
  const core = e.buildCore({ medium: "voice" });
  // The rename is a rename, not a rewrite. The prose that took months is still
  // all there, and the diction rules in particular have to survive it.
  assert.ok(core.length > 20000, `the core collapsed to ${core.length} chars`);
  assert.ok(/never use an em-dash/i.test(core), "the punctuation rule was lost");
  assert.ok(/no filler/i.test(core), "the diction trait was lost");
});
