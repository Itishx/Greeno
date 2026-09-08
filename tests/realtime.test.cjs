const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const rt = require("../app/lib/realtime.cjs");

// THE line. If Realtime is ever allowed to emit audio, you get a generic
// assistant voice out of the speakers and the character is gone. It fails
// silently and sounds fine, which is what makes it worth a test.
test("the Realtime API never speaks", () => {
  const cfg = rt.buildSessionConfig("gpt-realtime-mini");
  assert.deepStrictEqual(cfg.output_modalities, ["text"]);
});

test("we generate the reply, not Realtime", () => {
  const td = rt.buildSessionConfig("gpt-realtime-mini").audio.input.turn_detection;
  assert.strictEqual(td.create_response, false, "Realtime would answer for us");
  assert.strictEqual(td.interrupt_response, true, "barge-in would not interrupt");
  assert.strictEqual(td.type, "semantic_vad");
});

// Braino's server said "low" while both its clients said "medium", so the
// server's value was dead the instant the data channel opened. Ours must agree
// with what realtime.js sends in its session.update.
test("the server's eagerness matches what the client sends", () => {
  const server = rt.buildSessionConfig("gpt-realtime-mini").audio.input.turn_detection.eagerness;
  const client = fs.readFileSync(path.join(__dirname, "..", "app/renderer/realtime.js"), "utf8");
  const sent = /eagerness:\s*"([a-z]+)"/.exec(client)?.[1];
  assert.strictEqual(sent, server, `client sends "${sent}", server opens with "${server}"`);
});

// Without a language hint STT misdetects and he mirrors the wrong language back.
test("transcription is pinned to English", () => {
  const t = rt.buildSessionConfig("gpt-realtime-mini").audio.input.transcription;
  assert.strictEqual(t.language, "en");
  assert.strictEqual(t.model, rt.DEFAULT_TRANSCRIPTION_MODEL);
});

// The opening value is deliberately far_field: telling OpenAI the mic is at the
// user's mouth gets a laptop voice at arm's length scrubbed as room noise.
test("the opening noise reduction assumes a laptop, not a headset", () => {
  assert.strictEqual(rt.buildSessionConfig("gpt-realtime-mini").audio.input.noise_reduction.type, "far_field");
});

test("a caller cannot name an arbitrary model", () => {
  assert.strictEqual(rt.resolveModel("gpt-realtime"), "gpt-realtime");
  assert.strictEqual(rt.resolveModel("gpt-5-please-bill-me"), "gpt-realtime-mini");
  assert.strictEqual(rt.resolveModel(""), "gpt-realtime-mini");
  assert.strictEqual(rt.resolveModel(undefined), "gpt-realtime-mini");
});

test("a malformed offer is refused before it costs a request", async () => {
  await assert.rejects(() => rt.createCall({ offerSdp: "not sdp at all" }), /did not look like SDP/);
  await assert.rejects(() => rt.createCall({ offerSdp: "" }), /did not look like SDP/);
});

// The client half: the parts that are easy to regress by tidying.
test("the client mutes the remote track rather than skipping it", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app/renderer/realtime.js"), "utf8");
  assert.ok(/remoteAudio\.muted\s*=\s*true/.test(src), "the remote audio track is not muted");
  assert.ok(/pc\.addEventListener\("track"/.test(src), "the remote track is not attached at all");
});

test("the client asks for echo cancellation and nothing else", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app/renderer/realtime.js"), "utf8");
  assert.ok(/echoCancellation:\s*true/.test(src), "he will hear himself and answer himself");
  assert.ok(/noiseSuppression:\s*false/.test(src), "two noise reduction stages makes speech sound underwater");
  assert.ok(/autoGainControl:\s*false/.test(src));
});

// The session carries no persona precisely because Realtime never generates.
// Braino's 26k-character session.update, re-sent every turn, was ~900ms of dead
// air before each first word. Ours cannot have that problem unless someone adds
// instructions back.
test("the session carries no persona", () => {
  const cfg = rt.buildSessionConfig("gpt-realtime-mini");
  assert.ok(!("instructions" in cfg), "instructions on the session means re-reading them every turn");
  const src = fs.readFileSync(path.join(__dirname, "..", "app/renderer/realtime.js"), "utf8");
  assert.ok(!/instructions:/.test(src), "the client is pushing instructions onto the session");
});
