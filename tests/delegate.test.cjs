const test = require("node:test");
const assert = require("node:assert");
const d = require("../app/lib/delegate.cjs");
const actions = require("../app/lib/actions.cjs");

// Tier one has to be certain. A phrase that quits an app or takes over the
// machine cannot be a near miss.
test("commands are recognised without a model call", () => {
  const cases = [
    ["enter focus mode", "focus.on"],
    ["hey greeno, lets lock in", "focus.on"],
    ["can you start focus time", "focus.on"],
    ["i'm done with focus", "focus.off"],
    ["put on some lofi", "music.play"],
    ["play my focus playlist", "music.play"],
    ["pause the music", "music.pause"],
    ["open spotify", "app.open"],
    ["quit whatsapp", "app.quit"],
  ];
  for (const [said, want] of cases) {
    const got = d.parseIntent(said);
    assert.ok(got, `"${said}" was not recognised at all`);
    assert.strictEqual(got.action, want, `"${said}" routed to ${got.action}`);
  }
});

// The expensive half of certainty: everything that must NOT fire.
test("conversation never becomes a command", () => {
  for (const said of [
    "the music in that cafe was really good",
    "i keep opening whatsapp and losing an hour",
    "how was your day",
    "i am so tired of all this",
    "my focus has been terrible lately",
    "i should really close some tabs at some point",
    "she said the playlist was mid",
  ]) {
    assert.strictEqual(d.parseIntent(said), null, `"${said}" was treated as a command`);
  }
});

test("a parser that found no target does not guess", () => {
  // "open" with nothing after it is not an instruction, it is a fragment.
  assert.strictEqual(d.parseIntent("open"), null);
  assert.strictEqual(d.parseIntent("run my shortcut"), null);
});

test("he is stripped from the front of a command", () => {
  assert.strictEqual(d.normalize("Hey Greeno, open Spotify"), "open spotify");
  assert.strictEqual(d.normalize("Braino, pause the music."), "pause the music");
});

// The product law, enforced in code and not only in a prompt: there is no
// capability that talks to another person, so there is nothing to misuse.
test("nothing in the allowlist can contact a person", () => {
  for (const id of actions.ACTION_IDS) {
    assert.ok(
      !/message|text|mail|email|call|post|tweet|send/i.test(id),
      `${id} looks like it can reach a person. Chores get automated, relationships never do.`,
    );
  }
});

test("the classifier can only ever name a real capability", () => {
  const allowed = d.SCHEMA.properties.action.enum;
  for (const id of allowed) {
    assert.ok(id === "chat" || actions.ACTION_IDS.includes(id), `${id} is offered but cannot be performed`);
  }
  assert.ok(allowed.includes("chat"), "chat must be one of the answers or he cannot just talk");
});

test("quitting asks first, opening does not", () => {
  assert.strictEqual(actions.needsConfirm("app.quit"), true);
  assert.strictEqual(actions.needsConfirm("shortcut.run"), true);
  assert.strictEqual(actions.needsConfirm("app.open"), false);
  assert.strictEqual(actions.needsConfirm("focus.on"), false);
});

test("an action that does not exist is refused, not attempted", async () => {
  await assert.rejects(() => actions.perform("system.wipe", {}), /not something I can do/);
  await assert.rejects(() => actions.perform("app.open", {}), /no app named/);
});

test("only http links open", async () => {
  await assert.rejects(() => actions.perform("url.open", { url: "file:///etc/passwd" }), /http and https/);
  await assert.rejects(() => actions.perform("url.open", { url: "javascript:alert(1)" }), /http and https/);
});
