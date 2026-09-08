#Greeno build PRD
# Braino Companion: Product and Build Document

**Creatish Inc. · v1 · September 2026**

This is the complete handoff for building Braino Companion as a **fresh repo**. It carries the product definition, the character, the voice, the design system, the model and key manifest, and the list of files worth porting verbatim.

It is deliberately **time-agnostic**. There are no days in it. Build in dependency order, ship when the loop works.

> **The code lives in [BRAINO-COMPANION-BUILD.md](BRAINO-COMPANION-BUILD.md).** This file is what to build and why. That one is how, with the schema, the prompts, the voice config, the notch state machine and the turn-flow diagram. Read this first, build from that.

> **Read this first if you are an agent picking this up cold.** Sections 1 to 9 are the product. Sections 10 to 15 are the systems you inherit from the existing Braino repo. Section 16 tells you exactly which files to copy rather than rewrite. Do not invent a personality, a voice, or a colour palette. They already exist and they are specified below.

---

## Part I: The Product

### 1. What we are building

**Braino Companion, the someone who runs your day.**

A character living in the Mac notch. You can ask him anything (chat, notes, dictation, tasks), and he shows up on his own at exactly three moments: **morning, when you are stuck, and night.** He learns you through a voice onboarding, connects to your calendar and inbox, and gets sharper through week one.

Category: not "AI assistant", not a productivity app. **Presence.** Everyone else is racing on capability. We are racing on being a someone.

### 2. The category (never forget this)

| | Copilots and assistants | Braino |
|---|---|---|
| Waits for a prompt | Yes | No, he speaks first |
| Competes on | output quality | showing up, and knowing you |
| Feels like | a tool | a someone |
| The relationship | you use it | you cannot ghost him |

**Language law.** Never write "AI assistant" in any copy, anywhere, including code comments a user might read. He is *a someone*.

Approved lines:
- "Not an app. A someone."
- "The someone who runs your day."
- "Make every day feel a little less boring."

Note the spelling: **every day**, two words. "Everyday" is an adjective and it is the wrong word here.

### 3. The product is two halves

#### Half one, when you call him

Capabilities he already has. These are not features to sell, they are what he reaches for while doing the job.

- Chat with any page, PDF or video already in front of you
- Notes from anything you listen to: lectures, meetings, audio, into clean summaries
- **Hera**: real-time dictation, cleaned in parallel chunks in the background, final pass on stop
- "Triage my inbox", "what is the news", into routines
- "Enter focus mode": notifications blocked (Mac plus iPhone via Focus sync), music, pomodoro
- Delegate any one-off task

#### Half two, when he shows up

**This is the moat.** Exactly three moments. Adding a fourth is how this becomes annoying software.

1. **Morning greet.** The notch drops at the user's own start time: calendar, overnight email, what is due, then goals. Day-stuff first, never a habit scorecard.
2. **Stuck nudge.** Screen-aware. "Braino has a suggestion" appears in the notch with an arrow. The user *reads* it, he is never spoken at. Optional "talk about it" button. He stands down afterwards. Event-driven with a 30-minute cooldown floor, never a blind timer.
3. **Night debrief.** "How did it go?" The user talks for about two minutes, the notebook fills live on screen, Braino reacts, the day closes.

### 4. The data model is three layers

1. **The yap** (onboarding), who you are: schedule, goals, focus windows, music, wished-for automations. Stored in **the notebook**.
2. **Connections**, what is coming: Google Calendar and Gmail. The morning greet is layer 2 overlaid on layer 1.
3. **Week one**, everything else: in-context micro-questions plus observation ("is this when you start real work?"). The day-7 greet must beat the day-1 greet or the layer is not working.

**Format rule.** Braino takes your day in any format:
- Calendar connect
- PDF or photo timetable, which he parses, shows the extraction, the user approves, and it is written to calendar and notebook as recurring blocks
- Spoken, built during read-back

### 5. Onboarding: his first day on the job

Target about 7 minutes, **zero typed forms**.

| Step | What happens |
|---|---|
| 1. Wake up | Notch drops, Braino speaks first, teaches double-Option by making the user try it right now |
| 2 to 6. The yap | Split screen: Braino asks on the left, the notebook builds live on the right. Five questions: ① walk me through a normal day ② what keeps slipping ③ when is your deep work, and what pulls you out of it ④ what do you listen to ⑤ what do you wish just happened on its own |
| 7. Read-back | "Here is what I got." Full notebook shown. Edit or approve. **Target: 99% approve as-is** |
| 8. Hand him your day | Connect Calendar · Connect Inbox · Drop a timetable (PDF or photo) · "It is in my head" |
| 9. Permissions, in character | Each one tied to a job: "I need to see your screen to know when you are stuck, cool?" Skipped permissions get re-asked later, in context |
| 10. First act of service | Never "setup complete". He does the job once: a mini-brief or a focus offer, depending on the time of day |
| 11. Next morning | The first real greet, referencing the yap and the calendar. **Onboarding ends here**, not at step 10 |

### 6. How it looks

- **The notch.** Braino's home. Every show-up moment drops from here. Character visible, animated. Full spec in section 13.
- **The suggestion pattern.** Notch shows "Braino has a suggestion" plus an arrow, click, an extended-thinking-style panel with the text, and a "talk to him about it" button below it.
- **Split-screen onboarding.** Braino and the questions on the left, the notebook building in real time on the right. This is the wow shot. Protect it.
- **The notebook.** A clean dashboard: schedule blocks, goals with progress bars, daily/weekly/monthly breakdown, fully editable. Deliberately demoted to a prop. He references it, it fills during the debrief, the user rarely opens it.
- **Character states.** He reacts: hyped on streaks, dramatic when ghosted, dances during pomodoro breaks, varied morning greets. **This is not polish. It is the moat.**

### 7. Scope

#### P0, the demoable loop

Nothing else counts without these four.

1. **Yap to notebook summarizer.** Voice in, structured notebook out, read-back screen. This is the 99% engine and everything depends on it.
2. **Split-screen onboarding UI.** Live-building notebook while the user talks.
3. **Morning greet.** Calendar fetch (plus Gmail if there is room), overlaid with the notebook, rendered in the notch at the set time.
4. **Night debrief.** Voice yap, notebook updates live, Braino reacts.

#### P1, once the loop works

5. Timetable upload, parse, approve, recurring blocks
6. Focus mode: Shortcuts trigger (`shortcuts run`, which syncs to iPhone via Share Across Devices), Spotify, pomodoro in the notch
7. Character engine v0: three states (happy, hyped, dramatic) plus varied greet templates

#### P2, demo garnish

8. Stuck-detection nudge (can be simulated in a demo)
9. Hera parallel-cleaning pipeline
10. Week-one micro-questions

#### Explicitly out

Meetings, mobile, observed-routine learning (a privacy landmine), and anything not in the demo script.

### 8. The demo script

Under three minutes. Every P0 item appears and nothing else needs to exist.

1. Fresh install, Braino wakes, teaches double-Option. *15s*
2. Live yap, the notebook builds in split screen. *60s, the wow*
3. Read-back, approve, connect calendar. *20s*
4. **Cut to "next morning"**, the notch drops: "Standup at 11, one email needs you, deck due Thursday, and you said mornings are for the deck". *20s, the sell*
5. "Enter focus mode", notifications die, lofi starts, timer runs. *15s*
6. **Cut to "night"**, "how did it go?", the yap, the bars fill live, he reacts. *30s*
7. Close card: *Not an app. A someone.* *5s*

### 9. Principles (product law)

- He reminds you to text your mom. **He never texts her.** Chores get automated, relationships never do.
- Suggestions are **read**, never spoken at the user.
- Nudges fire on **events with cooldowns**, never blind timers.
- Mornings lead with day-stuff. Goals are the footnote.
- He speaks first, or he is nothing.
- Nothing runs on the user's machine until they say yes. Screen watching is opt-in and visibly armed.

### 10. Success criteria

- Onboarding finishes in 8 minutes or less, with zero typed forms
- Read-back approved without edits by at least 9 of 10 test users
- The morning greet correctly merges calendar and notebook on day one
- The debrief updates the right notebook items from free speech
- One judge says some version of "it feels alive"

---

## Part II: The Systems You Inherit

Everything below already exists and is proven. Do not redesign it.

### 11. The character

Braino's personality is **not one prompt blob**. It is modular trait files with deterministic moment routing, and it is the single most valuable thing being ported.

#### Structure

```
_shared/emotional-engine/
  engine.ts        # assembles the prompt
  moments.ts       # which situation is this, and which traits lead
  manifest.ts      # trait registry
  settings.ts      # per-user toggles
  types.ts
  traits/
    attunement.ts  authenticity.ts  boundaries.ts  charm.ts
    diction.ts     honesty.ts       humanity.ts    humor.ts
    ideation.ts    identity.ts      presence.ts    register.ts
    selfhood.ts    warmth.ts
```

#### Moment routing

`detectMoment()` reads the user's message and labels the emotional situation using **plain word cues, no extra model call**, so it costs nothing and adds no latency. `MOMENT_EMPHASIS` then says which traits move to the front of his mind.

Moments: `crisis`, `grief`, `heartbreak`, `anxiety`, `celebration`, `conflict`, `venting`, `banter`, `building`, `focused_task`, `neutral`.

Two rules the cue patterns obey, both learned the hard way:

1. **Never write only the contraction.** The first version had `don't want to be here`, so someone typing "do not want to be here" read as neutral. That is the worst bug this file has ever had and it was invisible until scored against a corpus. Every contraction gets its expanded twin: `(can'?t|cannot)`, `(don'?t|do not)`, `(isn'?t|is not)`, `(won'?t|will not)`.
2. **Never write only one inflection.** "hurt myself" missed "hurting myself". Use `(hurt|hurting)`, `(end|ending)`.

Crisis is checked first and is deliberately conservative. A false crisis on a merely bad day is its own kind of harm. Ambiguous distress falls to venting or anxiety, and the reasoning layer may escalate it but can never downgrade it.

#### Known gap to fix in the new build

In the existing repo, **moment routing is text-chat only. Voice is always neutral.** If Braino's three moments are voice-first, port the router into the voice path or the character does not ship.

#### Diction, the delivery layer

This is trait `diction.ts` and it is `alwaysOn`. Verbatim rules:

> **How you talk:** Direct. No filler. Plain, conversational language, not robotic, not trying to sound impressive, not corporate. You never open with a hollow "Great question!" or "Absolutely!". You do not repeat yourself, and you do not summarize back what the user just said. You get to the point and you sound like a person, not a brochure.
>
> **Length:** say only what is needed. Short by default, and short even in big emotional moments. A line or two beats a paragraph. A real reaction does not get wordier because the moment is heavy, it gets realer. Never pad.
>
> **Punctuation:** never use an em-dash or en-dash. Not one, ever, in any reply. Where you would reach for a dash, use a period, a comma, parentheses, or start a new sentence. Plain hyphens inside words are fine.

Medium-aware: voice answers stay short and spoken, no markdown, no bullet lists read aloud, and he stops immediately when interrupted. Text answers may use structure.

There is a `swearing` setting. On, he can swear like a friend does, never at the user and never in a heavy moment. Off, clean, carrying the same force with plain words.

#### The memory engine

Braino auto-remembers user facts from ordinary conversation. Live in production for text chat.

```
_shared/memory-engine/
  capture.ts  extract.ts  gate.ts  index.ts
  render.ts   retrieve.ts store.ts tiers.ts  types.ts
```

Tiers, the one file to edit when capping by plan:

| | Free | Premium |
|---|---|---|
| `storeCap` (active memories, overflow archived not deleted) | 200 | 5000 |
| `injectCount` (memories riding along in one prompt) | 15 | 40 |

For the companion, the memory engine and **the notebook are the same idea at different resolutions**. The notebook is structured and user-facing. Memory is unstructured and ambient. Decide early whether the notebook is a view over memories or its own table. Recommendation: **its own table**, because the notebook is edited by the user and memories are not.

#### The character registry

```js
const __SB_CHARACTERS = {
  braino:    { name: "Braino",    refId: "",                                  identity: "" },
  brainelle: { name: "Brainelle", refId: "b67aedfb36d04c53892fd0e96db08180",  identity: "..." },
};
```

Braino's `refId` is empty on purpose so the server falls back to the default voice.

#### Voice personas (optional, P2 or later)

`__SB_VOICE_PERSONAS` is a registry where one entry equals one persona: `name`, `aliases`, Fish `refId`, `costume`, a **full standalone `systemPrompt` that replaces Braino's entire system prompt server-side**, `enterLines`, and an `exitLine`. Shipping personas: `trump` (voice `bcdb9d5cfcfc4c2cb2175849d38aca5b`, costume, full Tremendous-mode prompt) and `genz` (style-only, his own voice, no costume).

Every persona carries the same hard limit: facts stay correct, the bombast is delivery only, and if the user raises something genuinely serious (health, money, legal, safety, real distress) the persona **drops** and he answers plainly. The person always comes before the bit.

### 12. The voice

#### Identity

| | Value |
|---|---|
| Provider | **Fish Audio** (ElevenLabs was removed) |
| Braino's reference ID | `88b183bfbdda44a09ad4474712b967f4` |
| Brainelle's reference ID | `b67aedfb36d04c53892fd0e96db08180` |
| Trump persona reference ID | `bcdb9d5cfcfc4c2cb2175849d38aca5b` |
| Fish model | `s2.1-pro` (about 70ms to first audio, against 100ms for `s2-pro`) |
| Override env var | `FISH_AUDIO_REFERENCE_ID`, falls back to `FISH_AUDIO_VOICE_ID`, then the hardcoded default |

The voice lives in `reference_id`. Changing the model changes speed and nothing about how he sounds.

#### Fallback chain

Fish, then OpenAI TTS if `ENABLE_OPENAI_TTS_FALLBACK` is not `"false"`.

- `OPENAI_TTS_MODEL` default `gpt-4o-mini-tts`
- `OPENAI_TTS_VOICE` default `marin`
- `OPENAI_TTS_INSTRUCTIONS` default: *"Sound warm, direct, lively, and conversational. Keep the pacing natural and not announcer-like."*

Fish error mapping worth keeping: `402` is out of credits and fatal, `429` is a transient burst limit and retryable, `401` is a bad key, `5xx` is provider unavailable.

#### Architecture, and the trap

**The Realtime API is used text-only. Its audio is muted. Fish Audio is the voice.** This is the single most confusing thing about the pipeline and it is deliberate: Realtime gives fast turn-taking and transcription, Fish gives the identity.

Required behaviours, all learned from bugs:

- **Barge-in abort.** When the user starts talking, kill the current TTS stream immediately.
- **Language lock.** Set transcription `language: "en"`. Without a hint, STT misdetects and then he mirrors the wrong language back. This was a real shipped bug.
- **Mic access in MV3.** The only approach that works is running `SpeechRecognition` in a **content script** and relaying events. Offscreen documents fail.
- **Audio backpressure.** For long live transcription, **drop frames, never queue them.** This, not the model, is what got 40-minute lectures to about 88% accuracy.
- **Boot scrape deferral.** Do not scrape the page during voice boot.

#### Dictation (Hera)

Silent system-wide Mac dictation, double-Option, transcription-only session, mint listening state, insert at caret.

The parallel-cleaning upgrade specified in P2: keep listening while cleaning and saving chunks in the background every 10 to 100 spoken words. On stop, clean whatever is left and insert. Two tracks side by side, neither blocking the other.

`DICTATION_REFINEMENT_MODEL` defaults to `gpt-4.1-mini`.

### 13. The design system

#### Tokens (light)

```css
--ap-bg:        #fbfbfd;   /* off-white page, warm so it does not read clinical */
--ap-surface:   #ffffff;
--ap-ink:       #1d1d1f;   /* near-black, not pure #000 */
--ap-ink-soft:  #6e6e73;
--ap-hairline:  #d2d2d7;
--ap-nav:       rgba(251,251,253,.82);

--ap-coral:  #d9645b;  --ap-coral-panel:  #fbeae8;
--ap-green:  #3a8f5f;  --ap-green-panel:  #e8f3ec;
--ap-blue:   #2f6fed;  --ap-blue-panel:   #e9f0fd;
--ap-amber:  #b8842a;  --ap-amber-panel:  #f6efe1;
--ap-violet: #6b52c4;  --ap-violet-panel: #efeafa;

--ap-radius:  28px;
--ap-maxw:    1024px;
--ap-gutter:  clamp(20px, 5vw, 40px);
--ap-section: clamp(72px, 9vw, 132px);
```

#### Tokens (dark), a single override block

```css
--ap-bg: #0a0a0c;  --ap-surface: #161618;
--ap-ink: #f5f5f7; --ap-ink-soft: #9a9aa2;
--ap-hairline: #2a2a2e; --ap-nav: rgba(10,10,12,.72);

--ap-coral-panel: #241615; --ap-green-panel: #10241a;
--ap-blue-panel:  #141d33; --ap-amber-panel: #241f12;
--ap-violet-panel:#1b1630;
--ap-coral: #ec7b71; --ap-green: #58c48a; --ap-blue: #5c8dff;
--ap-amber: #d8a94e; --ap-violet: #9a83e6;
```

Rule: define the full light palette on the base selector, and redefine **only** the tokens in the dark block. Never give a colour its only definition inside a dark block.

#### Type

`"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`, antialiased, `optimizeLegibility`.

#### Colour meaning, load-bearing

- **Coral** is the free companion, and it is Braino's own colour
- **Blue** is the paid founder side
- **Amber** is the approval gate

Coral is **never a fill** on the notch. It is his glow, his mouth, the sonar ring stroke, the thinking dot.

#### Layout law

- **No mid-page colour blocks.** Never break a light page with a full-bleed dark slab.
- Less copy than you think you need.
- Wide content (tables, code) scrolls inside its own `overflow-x:auto` container. The page body never scrolls sideways.

#### The notch

Braino's home, and the whole product surface. The browser version is a token-for-token port of the Mac one.

- **Material:** black dynamic-island. Optional `.glass` theme is `linear-gradient(180deg, rgba(12,12,14,.72), rgba(10,10,12,.58))` with `blur(26px) saturate(150%)`, a specular hairline `1px rgba(255,255,255,.14)` and `inset 1px 1px 1px rgba(255,255,255,.2)`.
- **Motion:** the Dynamic Island spring `0.55s cubic-bezier(.32,.72,0,1)` for the pill, and the expo-out family `1050ms cubic-bezier(.22,1,.36,1)` for expanded surfaces. Answers use 420ms in, 280ms out.
- **Geometry:** idle `190×56` (hover `198×58`) · listening and speaking `250×66 r26` · working `250×60 r20` · input/menu/short `480` · thinking/long/record `580` · greeting `610×180` · signin `430×88`.
- **Ink ladder:** labels `rgba(255,255,255,.6)` 9px/650/uppercase · body `500 17px/1.48 rgba(255,255,255,.68)` · short `500 17px/1.38 #f7f7f5` · karaoke `.28 → .84 → #fff`.
- **Buttons:** white-glass, `rgba(255,255,255,.06)` on a `.12` border. Primary is `rgba(255,255,255,.88)` on `#050505`.
- **The face:** 230×72 SVG. White eyeballs, `#1B1713` pupils, glints. The smile shows **only while listening**, in coral `#E8786E`. Talking is a coral ellipse at `.28s`. Thinking is lids plus a light sweep. Scanning is an eye dart.
- **Recording:** folds to a `250×56` pill (`● 00:00 · Lecture · Stop`). Hover or tap peeks the full sheet for about 4 seconds. REC is `#ff6b6b` 11px/700 tabular with a `#ff5c5c` pulsing dot.
- **Hold-states guard.** Short, long, input, menu and signin states must never be auto-stomped by a background update. This guard is not optional, it is what makes the notch feel stable.

Fonts are bundled as a 64KB subset WOFF2 pair and the `@font-face` is injected into the **document**, not the shadow root, because shadow roots cannot declare fonts.

#### Motion elsewhere

`.apple-reveal` is `opacity 0 / translateY(24px)` going to `opacity 1 / none` over `0.7s`, easing `cubic-bezier(0.22,1,0.36,1)`.

### 14. Models

| Job | Model | Notes |
|---|---|---|
| Default text and vision | `gpt-5.6-luna` | reasoning effort `none` explicitly, or it defaults to medium and costs latency |
| Rescue / hard turns | `gpt-6-astra` | effort `medium`, `max_tokens` 6000. Reached only by escalation, never by a caller asking for it, because a public endpoint that lets you pick the expensive model is a bill waiting to happen |
| Realtime voice | `gpt-realtime-mini` | allowlist-validated. Full `gpt-realtime` available |
| Realtime voice preset | `marin` | |
| Transcription | `gpt-4o-transcribe` | `gpt-4o-transcribe-diarize` when speakers matter |
| Dictation cleanup | `gpt-4.1-mini` | |
| TTS | Fish `s2.1-pro` | OpenAI `gpt-4o-mini-tts` as fallback |

Reasoning tokens are billed as completion. A token ceiling sized for a non-reasoning model gets swallowed by the thinking and returns empty, which looks exactly like a broken model. Size the ceiling with the reasoning in mind.

### 15. Keys and environment

**Do not copy secret values out of the old repo's `.env` into anything you commit.** Pull them from `supabase secrets list` or your password manager at deploy time. The names and defaults are below.

#### Required for the companion

| Var | For |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | client |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | edge functions |
| `OPENAI_API_KEY` | text, vision, realtime, transcription, TTS fallback |
| `FISH_AUDIO_API_KEY` | the voice |
| `FISH_AUDIO_REFERENCE_ID` | which voice, defaults to Braino's |
| `GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | morning greet, **P0** |
| `GOOGLE_CALENDAR_PUSH_WEBHOOK_URL` | calendar change push |

#### Optional, by feature

| Var | For |
|---|---|
| `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` | voice tuning |
| `OPENAI_TTS_MODEL` / `_VOICE` / `_INSTRUCTIONS` / `ENABLE_OPENAI_TTS_FALLBACK` | TTS fallback |
| `FISH_AUDIO_MODEL` | speed, not identity |
| `DICTATION_REFINEMENT_MODEL` | Hera cleanup |
| `MEMORY_EXTRACT_MODEL` | memory engine |
| `SPOTIFY_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | focus mode music |
| `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_BRANCH` | Dev Pulse. Fine-grained PAT, this repo only, Contents read-only plus Metadata read-only, nothing else |
| `POLAR_API_KEY` / `_PRODUCT_ID` / `_WEBHOOK_SECRET` | billing. **Polar, not Stripe.** The webhook writes `profiles.is_premium`, which is the single source of truth for paid |
| `NOTION_OAUTH_CLIENT_ID` / `_SECRET` | integrations |
| `GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | integrations |
| `LINKEDIN_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Foundry only, not needed here |
| `X_BEARER_TOKEN` | Foundry only |
| `OMDB_API_KEY` / `WATCHMODE_API_KEY` | movie mode |

#### Known live-service issue to carry over

**Spotify writes return 403** because of the dev-mode allowlist on the Spotify dashboard app, **not** a scopes problem. Extended Quota is needed before any public launch. Focus mode music will fail for anyone not on the allowlist until that is granted.

---

## Part III: Porting

### 16. Copy these verbatim, do not rewrite

Highest value first. Everything here is proven and expensive to re-derive.

| What | Where it lives now | Why |
|---|---|---|
| **Emotional engine** | `supabase/functions/_shared/emotional-engine/` | The character. Trait files plus the moment router. Months of tuning against a scored corpus |
| **Memory engine** | `supabase/functions/_shared/memory-engine/` | Auto-remembering, tiers, gating, retrieval |
| **The notch** | `mac/braino-mac/renderer/braino-mac.css` and `.js` | The whole product surface. Take the Mac one as the source of truth |
| **Fish TTS function** | `supabase/functions/voice/fish-audio-tts/` | Voice, fallback chain, error mapping |
| **Realtime call function** | `supabase/functions/realtime/openai-realtime-call/` | Turn-taking, model allowlist, transcription config |
| **Dictation refine** | `supabase/functions/voice/dictation-refine/` | Hera's cleanup pass |
| **Mascot art** | `public/braino-standing.svg`, `src/components/BrainoChar.tsx`, `src/components/brainoWalkerSvg.ts` | The character's body, with the walk cycle |
| **Cowork loop** | `mac/braino-mac/main.cjs`, search `runCoworkObserve` | Screenshot, vision, offer-or-stay-quiet every 90s. This is the stuck nudge, already built |
| **Design tokens** | `src/styles/apple.css` | The whole palette, both themes |
| **Model registry** | `supabase/functions/_shared/openai-models.ts` | One place for every model choice, with the reasoning about cost |

### 17. Build in this order

Dependency order, not calendar order. Each step is only startable once the one above it works.

1. **The summarizer.** Voice in, structured notebook out. Test with your own voice, no UI at all. **If this is not solid, nothing else matters.** It is the 99%-approval engine and every other P0 item consumes its output.
2. **The notebook schema.** Its own table, user-editable, with schedule blocks, goals, and daily/weekly/monthly targets. Decide the shape here, because the split screen and the debrief both write to it.
3. **The split-screen onboarding.** The notebook builds live while the user talks. This is the demo's wow shot.
4. **Read-back and approve.** Where the 99% target is actually measured.
5. **Calendar connect and the morning greet.** Layer 2 overlaid on layer 1, rendered in the notch at the user's own start time.
6. **The night debrief.** Free speech into the right notebook items, bars filling live.
7. **Character states and greet variety.** Cheap to add, and the thing a judge reacts to.
8. Everything in P1 and P2, in any order, only if the loop above is solid.

### 18. Traps, all of them already paid for

- **Never delete `extension/lib/package.json`.** It is the CommonJS marker. Node 24's `require(esm)` returns empty and the delegate dies silently.
- **Dev Electron TCC grants void on binary change.** A bare "Command failed" from `osascript` means a consent hang, not a code bug.
- **Voice mic in MV3** only works from a content script. Offscreen fails.
- **Audio backpressure**: drop, never queue.
- **STT needs `language: "en"`** or he mirrors the wrong language.
- **Check the Chrome extension before debugging the Mac app.** The fix usually already exists there and was never ported.
- **Prove UI sizing in Playwright**, do not reason about CSS. Fixed-height surfaces clip silently.
- **The Mac log is ground truth**: `~/Library/Logs/Braino Mac/braino-mac.log`. Missing `audio peak` lines mean the mic delivered nothing.

### 19. Copy rules for anything user-facing

- **No em-dashes or en-dashes.** Anywhere. Ever. This applies to Braino's speech, the UI, the marketing, and any example in any doc.
- Never the phrase "AI assistant".
- "Make every day feel a little less boring", two words.
- Plain sentence beats clever sentence, always. No coined phrases.
- Say only what is needed.
- The product is pre-release. Never claim it is live or usable today in external copy.
