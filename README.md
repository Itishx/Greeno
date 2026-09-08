# Greeno

**Not an app. A someone.**

A companion that lives in the Mac notch. He learns you through a voice onboarding,
holds your day, and shows up on his own at exactly three moments: morning, when
you look stuck, and night.

Built on Braino: the voice, the personality engine and the notch behaviour are
ported from the Braino repo. Greeno is the character.

---

## Run it

```bash
npm install
cp .env.example .env      # then fill in OPENAI_API_KEY and FISH_AUDIO_API_KEY
npm run mac:dev
```

That one command builds the engine bundle, compiles the double-Option helper if
it is missing, and launches the app.

| | |
|---|---|
| `npm run mac:dev` | run it |
| `npm run mac:debug` | the same, with DevTools open on both windows |
| `npm test` | the suite |
| `npm run build` | just the engine bundle and the native helper |

### Only one at a time

He holds a single-instance lock. A second `npm run mac:dev` quits immediately and
brings the first one's notebook forward instead. Without it you get two notch
windows, two mascots walking around, two hotkey helpers and the same morning
greet firing twice, and it all looks like a duplication bug in the app rather
than the app simply running twice.

### The one trap baked out of your way

This shell exports `ELECTRON_RUN_AS_NODE=1`, which tells Electron to run as a
plain Node interpreter. An app started that way never opens a window and never
says why. `mac:dev` clears it for you (`env -u ELECTRON_RUN_AS_NODE`), so it only
bites if you invoke `electron .` by hand.

### Permissions he asks for, and what each is actually for

| Permission | Without it |
|---|---|
| Microphone | The whole product. Nothing works. |
| Accessibility | Double-Option stops working. The `Alt+Space` fallback still does. |
| Screen Recording | The stuck nudge cannot see anything, so it never fires. |
| Automation | He cannot start focus, open or quit an app, or touch your music. |

Accessibility and Screen Recording grants are keyed to the **binary**, so in
development every rebuild voids them. The symptom is not a permission dialog. It
is a bare `Command failed` from `osascript`, which is a consent prompt hanging
invisibly. If you see that and the code looks right, the code is right. Re-grant.

---

## The three sections

Everything he knows about you is one notebook with three sections, and the
dashboard, the summarizer prompt and the debrief all use the same three words.

- **Routines** — the recurring shape of your day, plus the automations you wish
  you had. A wish is a routine that does not exist yet.
- **Habits** — the things with a target and a cadence. What he holds you to.
  What keeps slipping hangs off this section.
- **Focus** — when your head is clear, what pulls you out, what you listen to.

## The boot

Ported beat for beat from Braino's `runNotchBoot`:

1. a spectrum trace draws the perimeter of the notch — **1550ms**
2. `G R E E N O` resolves, one letter at a time — **2200ms**
3. the **match cut**: the word collapses to the width of the eye pair and his
   eyes bloom from the same centre, so one becomes the other rather than one
   fading while the other appears somewhere else — **1100ms**, with a wake chime
4. the island extends to 610x180 and he says, out loud, in his own voice:
   *"Hi, I am Greeno. I am here to hold you accountable."* — **1850ms**
5. he climbs out of the notch and the app opens behind him

The window is held until step 5, so he arrives first rather than talking over a
form. If the notch never reports in, the window opens anyway after 16 seconds: a
missed animation must never cost somebody the whole app.

The full performance runs once, on a machine with no approved notebook. Every
launch after that is a wake: trace, eyes, done, about three seconds and no
speech. A seventeen second introduction every morning is a thing you would grow
to hate.

The line is fetched during the first beat and played from memory at the fourth,
so his voice starts when the card lands rather than a round trip later.

## Talking to him

Double-Option (or double-Control) opens a live voice lane and closes it. While
it is open you just talk, and you can talk over him.

It is WebRTC to OpenAI's Realtime API, and the shape is the one thing worth
understanding:

**The Realtime API never speaks.** `output_modalities: ["text"]`. It is there for
fast turn-taking and streaming transcription. Fish is the voice. Let Realtime
emit audio and you get a generic assistant voice and the character is gone. The
remote track is attached and then muted, rather than skipped, so the negotiation
stays standard.

**It never generates, either.** `create_response: false`. Every reply comes from
the same turn pipeline the rest of the app uses, so the moment router, the
notebook, memory and the delegate allowlist all still apply. Braino does it the
other way and pays for it: pushing the persona onto the session meant a 26,000
character `session.update` re-read before every answer, which was ~900ms of dead
air before each first word. Greeno's session carries no instructions at all, so
that cannot happen here. There is a test that fails if anyone adds them.

**Barge-in is the point.** `input_audio_buffer.speech_started` fires the instant
you open your mouth, and that kills the Fish stream immediately rather than after
the current sentence.

Two details that are easy to get wrong and silent when you do:

- The client owns the microphone and sends the real noise-reduction verdict on
  `session.update` once the channel opens. `near_field` for a headset,
  `far_field` for a laptop mic. The server's opening default is `far_field`,
  because telling OpenAI the mic is at your mouth gets a voice at arm's length
  scrubbed as room noise.
- `eagerness` has to be the same on both sides. Braino's server said `low` while
  both of its clients said `medium`, so the server's value was dead the instant
  the channel opened. A test compares the two.

## The three moments

Exactly three. A fourth is how this becomes annoying software, so there is no
fourth timer in `main.cjs`.

1. **Morning greet** — fires inside a 45 minute window after your own start time,
   once a day. Calendar and routines first, habits last and only as a clause.
2. **Stuck nudge** — a screen glance every 90 seconds, but a 30 minute floor
   before he may speak, enforced against the show-up log. He renders "Greeno has
   a suggestion" and waits to be opened. Suggestions are read, never spoken at.
3. **Night debrief** — you talk, the bars fill live, he reacts.

Armed automations are not a fourth moment: they do something and say nothing.

---

## What he can do to your Mac

A closed allowlist in `app/lib/actions.cjs`. The delegate router can only ever
name something on it.

`focus.on` · `focus.off` · `app.open` · `app.quit` · `url.open` · `music.play` ·
`music.pause` · `shortcut.run`

Two rules are enforced in code rather than in a prompt:

- **Quitting an app and running a Shortcut ask first.** Closing someone's unsaved
  work is not undoable.
- **Nothing on the list can contact a person.** There is no send, no message, no
  mail, no call. He will remind you to text your mum. He will never text her.
  There is a test that fails if anyone adds one.

Focus goes through **Shortcuts**, not a fake local Do Not Disturb, because a
Shortcut that sets a Focus syncs to your iPhone by itself through Share Across
Devices. Make a Shortcut that sets a Focus, name it `Greeno Focus`, and he uses it.

### How a spoken line becomes an action

Two tiers, the same shape Braino already uses:

1. **Word cues first** (`delegate.cjs`). Free, instant, testable, and strict.
   "Put some music on" is a command. "The music in that cafe was good" is not.
2. **One model call as the fallback**, returning strict JSON naming one action
   from the allowlist, or `chat`. `chat` is most of the time, and it is the safe
   default: doing nothing is recoverable, quitting the wrong app is not.

---

## Layout

```
app/
  main.cjs              the shell, the three moments, the IPC
  preload.cjs           the only bridge
  native/
    GreenoHotkey.swift  double-Option, via a listen-only CGEventTap
  lib/
    emotional-engine/   PORTED WHOLE from Braino. Never edited here.
    memory-engine/      PORTED. Six of its eight files, verbatim.
    engine-entry.ts     the companion's own additions, and the only edited file
    engine.cjs          the built bundle (npm run build:engine)
    store.cjs           notebook, check-ins, show-ups
    notebook.cjs        the shape, and every pure function over it
    yap.cjs             voice in, structured notebook out
    greet.cjs           the morning greet
    debrief.cjs         the night debrief
    nudge.cjs           the stuck glance and its cooldown
    turn.cjs            personality plus notebook plus context, one prompt
    memory.cjs          the memory engine, wired to the local store
    realtime.cjs        the session config and the SDP exchange
    actions.cjs         what he can do to this Mac
    delegate.cjs        command or conversation
    tts.cjs             Fish, then OpenAI
    openai.cjs          every model call
  renderer/
    notch.*             the notch, its state machine and the karaoke
    onboarding.*        the split screen
    notebook.*          the dashboard
    walker*.js          Greeno's rig and his walk cycle
    speech.js           him talking, and him shutting up
    realtime.js         him listening, live, and knowing when to stop
```

## Tests

```bash
npm test
```

49 run with your keys in `.env`. 47 need no key at all. Two more, the ones that actually decide whether the product
works, need `OPENAI_API_KEY` in `.env`:

- the summarizer fills all three sections from a real yap, in the person's own
  words, inventing no numbers
- not mentioning a habit is not the same as failing at it

`tests/live.test.cjs` holds one real yap as a fixture. **Add every real transcript
you record to it.** That file is the corpus the 99% approval target is measured
against, and it is worth more than any other test here.

---

## What is not built

Said plainly so nobody discovers it during a demo.

- **Google Calendar is not connected.** The morning greet works, and falls back to
  your own routines. Wire `GOOGLE_CALENDAR_*` in `.env` and the layer-2 merge
  turns on. Gmail is the same.
- **No timetable upload** (PDF or photo). The "it is in my head" path is the one
  that works.
- **No pomodoro, no Spotify OAuth.** Music control is local AppleScript, which
  needs the app already running. Spotify writes 403 on a dev-mode app anyway,
  which is an allowlist problem and not a scopes one.
