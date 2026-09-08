// The notch. Every show-up is a state transition, and the geometry per state is
// fixed in CSS so the spring animates between known sizes rather than measuring
// content mid-flight.
(() => {
  const $ = (id) => document.getElementById(id);
  const nf = $("nf");

  // short, long, input, menu and signin are states a person is CURRENTLY USING.
  // A background update that stomps one of them yanks the UI out from under a
  // hand that is mid-sentence. Everything else may be replaced freely. This
  // guard is not optional: it is what makes the notch feel stable.
  const HELD = new Set(["short", "long", "input", "menu", "signin"]);
  let current = "idle";

  // Two things want the window to stop ignoring the mouse: an open surface, and
  // the pointer being over Greeno. They have to be OR'd, or whichever one runs
  // last wins and the other silently stops working.
  const wants = { surface: false, walker: false };
  let interactiveNow = false;
  function syncInteractive() {
    const next = wants.surface || wants.walker;
    if (next === interactiveNow) return;
    interactiveNow = next;
    window.greeno.interactive(next);
  }

  function setState(next, { force = false } = {}) {
    if (!force && HELD.has(current) && next !== current) return false;
    current = next;
    nf.dataset.state = next;
    // Click-through goes OFF only while something is genuinely interactive, and
    // back ON the instant it closes.
    wants.surface = next !== "idle" && next !== "working";
    syncInteractive();
    return true;
  }

  function showSurface(which) {
    for (const [id, on] of Object.entries({
      "nf-core": which === "core",
      "nf-tease": which === "tease",
      "nf-rec-surface": which === "rec",
      "nf-say-surface": which === "say",
    })) {
      const el = $(id);
      if (id === "nf-core") el.style.display = on ? "" : "none";
      else el.classList.toggle("is-on", on);
    }
  }

  function setMouth(m) {
    // "" rather than "block": the stylesheet still gets to hide it at rest,
    // where there is no room to draw it.
    $("nf-mouth-idle").style.display = m === "closed" ? "" : "none";
    $("nf-mouth-listen").style.display = m === "listen" ? "" : "none";
    $("nf-mouth-talk").style.display = m === "talk" ? "" : "none";
  }

  // ── his face follows the voice, not the text ─────────────────────────────
  let walker = null;
  window.GreenoSpeech.on("start", () => {
    setMouth("talk");
    if (walker) walker.talking = true;
  });
  window.GreenoSpeech.on("end", () => {
    setMouth("closed");
    if (walker) walker.talking = false;
  });


  // ── the karaoke ──────────────────────────────────────────────────────────
  // Ported from braino-mac.js: appendNotchAnswerWords / paintNotchAnswer /
  // trackNotchAnswerAudio / finishNotchAnswer. Words light up off the audio's
  // own playback position, so the text and the voice cannot drift apart.
  let nfWords = [];
  let nfCompletedWords = 0;
  let nfGeneration = 0;
  let nfRaf = 0;
  let nfMode = "short";
  let nfLastScrollIndex = -1;
  let nfLingerTimer = null;

  // 240 characters is where a reply stops being a line and becomes something you
  // read, which is a different surface and a different geometry.
  function answerKind(text) {
    return String(text || "").trim().length >= 240 ? "long" : "short";
  }

  function appendNotchAnswerWords(parent, text, startIndex = 0) {
    let index = startIndex;
    String(text || "").split(/(\s+)/).forEach((token) => {
      if (!token) return;
      if (/^\s+$/.test(token)) { parent.appendChild(document.createTextNode(token)); return; }
      const word = document.createElement("span");
      word.className = "nf-answer-word";
      word.dataset.wordIndex = String(index);
      word.textContent = token;
      parent.appendChild(word);
      index += 1;
    });
    return index;
  }

  function paintNotchAnswer(highlightedWords) {
    if (!nfWords.length) return;
    const count = Math.max(0, Math.min(nfWords.length, Math.floor(highlightedWords)));
    nfWords.forEach((word, index) => {
      word.classList.toggle("spoken", index < count);
      word.classList.toggle("speaking-now", index === count && count < nfWords.length);
    });

    // A long answer scrolls itself, but only every seventh word. Scrolling on
    // every word turns reading into chasing.
    if (nfMode === "long" && count < nfWords.length && count !== nfLastScrollIndex
        && (count === 0 || count - nfLastScrollIndex >= 7)) {
      nfLastScrollIndex = count;
      const activeWord = nfWords[count];
      const article = $("nf-say-body");
      if (activeWord && article) {
        const a = article.getBoundingClientRect();
        const w = activeWord.getBoundingClientRect();
        if (w.bottom > a.bottom - 24 || w.top < a.top + 24) {
          activeWord.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    }
  }

  function trackNotchAnswerAudio(audio, spokenText, generation) {
    if (!audio || generation !== nfGeneration || !nfWords.length) return;
    const chunkWords = Math.max(1, String(spokenText || "").trim().split(/\s+/).filter(Boolean).length);
    const chunkStart = nfCompletedWords;

    const tick = () => {
      if (generation !== nfGeneration || audio.paused || audio.ended) return;
      // MP3 streams do not expose a stable duration until their final bytes
      // land, so fall back to a natural 2.75 spoken words per second.
      const fraction = Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.min(1, audio.currentTime / audio.duration)
        : Math.min(.98, (audio.currentTime * 2.75) / chunkWords);
      paintNotchAnswer(chunkStart + Math.max(1, Math.floor(chunkWords * fraction)));
      nfRaf = requestAnimationFrame(tick);
    };

    audio.addEventListener("playing", () => { cancelAnimationFrame(nfRaf); tick(); }, { once: true });
    audio.addEventListener("ended", () => {
      nfCompletedWords = Math.min(nfWords.length, chunkStart + chunkWords);
      paintNotchAnswer(nfCompletedWords);
    }, { once: true });
  }

  // For text he never says out loud, which is every suggestion. Read, not spoken.
  function animateNotchAnswerEstimate(text, generation, durationMs) {
    if (generation !== nfGeneration || !nfWords.length) return;
    const startedAt = performance.now();
    const duration = Math.max(500, Number(durationMs) || String(text || "").length * 58);
    const frame = (now) => {
      if (generation !== nfGeneration) return;
      const fraction = Math.min(1, (now - startedAt) / duration);
      paintNotchAnswer(Math.max(1, Math.floor(nfWords.length * fraction)));
      if (fraction < 1) nfRaf = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(nfRaf);
    nfRaf = requestAnimationFrame(frame);
  }

  function finishNotchAnswer(generation, lingerMs) {
    if (generation !== nfGeneration) return;
    cancelAnimationFrame(nfRaf);
    paintNotchAnswer(nfWords.length);
    const linger = lingerMs ?? (nfMode === "long" ? 9000 : 4200);
    clearTimeout(nfLingerTimer);
    nfLingerTimer = setTimeout(() => { if (generation === nfGeneration) rest(); }, linger);
  }

  // Every sentence he speaks hands its audio element over, so the words light up
  // off real playback rather than a guess.
  window.GreenoSpeech.on("audio", (audio, text, generation) => {
    trackNotchAnswerAudio(audio, text, generation);
  });

  // ── saying something, with buttons ───────────────────────────────────────
  let holdTimer = null;

  function say(label, text, actions = [], { state, speak = true, holdMs = 0 } = {}) {
    clearTimeout(holdTimer);
    clearTimeout(nfLingerTimer);
    cancelAnimationFrame(nfRaf);

    nfMode = answerKind(text);
    const target = state || (nfMode === "long" ? "long" : "short");

    $("nf-say-label").textContent = label;

    // The words are spans, not text. This is the whole karaoke.
    const body = $("nf-say-text");
    body.replaceChildren();
    appendNotchAnswerWords(body, text);
    nfWords = Array.from(body.querySelectorAll(".nf-answer-word"));
    nfCompletedWords = 0;
    nfLastScrollIndex = -1;
    paintNotchAnswer(0);

    const host = $("nf-say-actions");
    host.innerHTML = "";
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = `nf-btn${a.primary ? " primary" : ""}`;
      b.type = "button";
      b.textContent = a.label;
      b.addEventListener("click", () => { a.onClick?.(); });
      host.appendChild(b);
    }

    // Measured once, then the fixed geometry animates to it. A surface sized
    // from content mid-flight clips silently.
    const lines = Math.ceil(text.length / 62);
    nf.style.setProperty("--nf-answer-short-height", `${Math.max(146, 96 + lines * 26)}px`);
    nf.style.setProperty("--nf-answer-long-height", `${Math.min(330, 118 + lines * 26)}px`);

    setState(target, { force: true });
    showSurface("say");

    if (speak) {
      // The speech layer owns the generation, so the karaoke rides the same
      // number and a barge-in retires both at once.
      window.GreenoSpeech.speak(text).then(() => {
        finishNotchAnswer(nfGeneration, holdMs || undefined);
      });
      nfGeneration = window.GreenoSpeech.generation;
    } else {
      nfGeneration += 1;
      animateNotchAnswerEstimate(text, nfGeneration);
      if (holdMs) holdTimer = setTimeout(rest, holdMs);
    }
  }

  function rest() {
    clearTimeout(holdTimer);
    if (mode) stopVoice("rest");   // or the microphone stays open behind a closed notch
    clearTimeout(nfLingerTimer);
    cancelAnimationFrame(nfRaf);
    nfGeneration += 1;              // everything still painting is now stale
    nfWords = [];
    window.GreenoSpeech.stop("resting");
    current = "idle";                 // leave the held state deliberately
    setState("idle", { force: true });
    showSurface("core");
    setMouth("closed");
  }


  // A one-line aside that does not disturb whatever surface is open. He is being
  // handled, not asked a question, so this never takes the notch over.
  let flashTimer = null;
  function flash(text) {
    if (current !== "idle") return;
    clearTimeout(flashTimer);
    $("nf-tease-text").textContent = text;
    setState("working", { force: true });
    showSurface("tease");
    flashTimer = setTimeout(() => {
      if (current === "working") { current = "idle"; setState("idle", { force: true }); showSurface("core"); }
    }, 1500);
  }

  // ── the boot ─────────────────────────────────────────────────────────────
  //
  // Ported beat for beat from Braino's runNotchBoot. The timings are theirs and
  // are not guesses: 1550 for the trace, 2200 for the name (long enough that
  // every letter gets a clean beat), 1100 for the match cut, 1850 for the card
  // to settle before he opens his mouth.
  //
  // Braino spends the second beat running real authentication behind the name.
  // Greeno has no sign-in, so it is a fixed beat. Same shape, nothing pretending
  // to be work that is not happening.

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let wakeAudioCtx = null;

  // A soft two-note rise the instant his eyes open. Synthesized, so there is no
  // asset to bundle and nothing for a CSP to block.
  function playWakeChime() {
    try {
      wakeAudioCtx = wakeAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = wakeAudioCtx;
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      // E5 then B5, with a bell-like fade.
      [{ f: 659.25, t: 0 }, { f: 987.77, t: 0.11 }].forEach(({ f, t }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, now + t);
        gain.gain.exponentialRampToValueAtTime(0.12, now + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + t);
        osc.stop(now + t + 0.55);
      });
    } catch { /* a silent boot is survivable */ }
  }

  const BOOT_LINE = "Hi, I am Greeno. I am here to hold you accountable.";

  async function runBoot({ full = true } = {}) {
    // 1. The spectrum trace draws the perimeter.
    nf.classList.add("is-booting", "is-shining", "is-shine-slow");

    // The line is fetched now and played later. Four seconds of animation is
    // plenty of time to pay for a round trip nobody should have to wait through.
    if (full) window.GreenoSpeech.prefetch(BOOT_LINE);

    // A short boot on every launch after the first. He still wakes up; he just
    // does not introduce himself to someone who already knows him.
    if (!full) {
      await wait(900);
      nf.classList.add("is-awake");
      playWakeChime();
      await wait(800);
      nf.classList.remove("is-booting", "is-shining", "is-shine-slow", "is-awake");
      setState("idle", { force: true });
      showSurface("core");
      if (walker) {
        walker.place(window.innerWidth / 2 - 32, Math.round(window.innerHeight * 0.27));
        walker.show();
        walker.setRoam(true);
      }
      try { await window.greeno.bootDone(); } catch { /* the app opens anyway */ }
      return;
    }

    await wait(1550);

    // 2. The name resolves, one letter at a time.
    nf.classList.add("is-naming");
    await wait(2200);

    // 3. The match cut. The word collapses to the width of the eye pair and the
    //    eyes bloom from the same centre.
    nf.classList.remove("is-naming");
    nf.classList.add("is-awake");
    playWakeChime();
    await wait(1100);

    // 4. The island extends and he introduces himself.
    nf.classList.add("is-greeting");
    await wait(1850);

    // Spoken only after the words and the divider have landed, through the same
    // Fish-first path as every other line he says.
    window.GreenoSpeech.noteSpoken(BOOT_LINE);
    try { await window.GreenoSpeech.speak(BOOT_LINE); } catch { /* keep going */ }
    await wait(300);

    // 5. The island closes FIRST, all the way back to a pill, and only then does
    //    he climb out of it. Moving him while it is still 610px wide reads as
    //    him falling out of a slab rather than stepping out of the notch.
    nf.classList.remove("is-greeting");
    setState("idle", { force: true });
    await wait(620);              // the spring settling, 0.55s plus a beat

    if (walker) {
      // Only now does any part of him exist on the screen.
      const landingY = Math.min(260, Math.max(150, Math.round(window.innerHeight * 0.27)));
      walker.place(window.innerWidth / 2 - 32, 40);
      walker.show();
      walker.el.classList.add("is-boot-jump");
      walker.walkTo(window.innerWidth / 2 - 32, landingY);
      setTimeout(() => {
        walker.el.classList.remove("is-boot-jump");
        walker.setRoam(true);          // now he lives here
      }, 1250);
    }
    await wait(900);

    nf.classList.remove("is-booting", "is-shining", "is-shine-slow", "is-awake");
    setState("idle", { force: true });
    showSurface("core");

    // Only now does the window appear. He arrives first.
    try { await window.greeno.bootDone(); } catch { /* the app opens anyway */ }
  }

  // ── the three moments ────────────────────────────────────────────────────
  window.greeno.onMorning(({ said }) => {
    if (!said) return;
    // He climbs out of the notch and waves, rather than appearing.
    if (walker) { walker.launch(window.innerWidth / 2 - 32, 56); walker.setMood("hyped"); }
    say("Good morning", said, [
      { label: "Thanks", onClick: rest },
      { label: "Open my day", primary: true, onClick: () => { window.greeno.openBook({ route: "notebook" }); rest(); } },
    ], { state: "greeting", holdMs: 26000 });
  });

  window.greeno.onNight(() => {
    say("How did it go?", "Talk me through the day. I am listening.", [
      { label: "Not now", onClick: rest },
      { label: "Tell him", primary: true, onClick: () => startVoice("debrief") },
    ], { state: "long", holdMs: 45000 });
  });

  // Suggestions are READ, never spoken at. The notch teases, and waits to be
  // opened. Once it is opened or dismissed, the cooldown is already running.
  window.greeno.onStuck(({ said, id }) => {
    if (!setState("working")) return;      // never stomp a state in use
    showSurface("tease");
    $("nf-tease-text").textContent = "Greeno has a suggestion";

    const open = () => {
      $("nf-tease").removeEventListener("click", open);
      window.greeno.markActed({ id });
      say("Greeno has a suggestion", said, [
        { label: "Not now", onClick: rest },
        { label: "Talk about it", primary: true, onClick: () => { rest(); startVoice("chat", said); } },
      ], { state: "long", speak: false });   // read, never spoken
    };
    $("nf-tease").addEventListener("click", open);

    // He stands down afterwards.
    holdTimer = setTimeout(() => {
      $("nf-tease").removeEventListener("click", open);
      rest();
    }, 40000);
  });

  // ── the conversation ─────────────────────────────────────────────────────
  //
  // One lane for both talking to him and the night debrief. The difference is
  // only what happens to a finished phrase: in chat it becomes a turn, in a
  // debrief it is collected until you say you are done.

  let mode = null;                 // null | "chat" | "debrief"
  let debriefParts = [];
  let debriefStartedAt = 0;
  let recTimer = null;
  let chatSeed = "";
  const history = [];

  function liveCaption(text) {
    $("nf-say-label").textContent = mode === "debrief" ? "How did it go?" : "Listening";
    const body = $("nf-say-text");
    body.replaceChildren(document.createTextNode(text));
    if (current !== "short" && current !== "long") {
      setState(text.length > 90 ? "long" : "short", { force: true });
      showSurface("say");
    }
  }

  async function startVoice(nextMode, seed = "") {
    if (mode) return;
    mode = nextMode;
    chatSeed = seed;
    debriefParts = [];
    debriefStartedAt = Date.now();
    clearTimeout(holdTimer);

    // Anything he was mid-sentence on stops the moment you decide to talk.
    window.GreenoSpeech.stop("starting a conversation");

    setState("listening", { force: true });
    showSurface("core");
    setMouth("listen");
    if (walker) walker.voiceActive = true;

    // The light travels the perimeter again. Re-triggering a CSS animation needs
    // the class off, a reflow, then on, or the second wake is silent.
    nf.classList.remove("is-waking");
    void nf.offsetWidth;
    nf.classList.add("is-waking");
    setTimeout(() => nf.classList.remove("is-waking"), 700);

    if (nextMode === "debrief") {
      const t0 = Date.now();
      clearInterval(recTimer);
      recTimer = setInterval(() => {
        const secs = Math.floor((Date.now() - t0) / 1000);
        $("nf-rec-time").textContent =
          `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
      }, 500);
    }

    try { await window.greeno.micPermission(); } catch { /* start reports the real problem */ }

    const ok = await window.GreenoRealtime.start({
      ready: () => {
        if (mode === "debrief") { setState("record", { force: true }); showSurface("rec"); $("nf-rec-meta").textContent = "Talk me through it"; }
      },

      // He stops the instant you open your mouth. This is the whole point.
      speechStart: () => {
        if (window.GreenoSpeech.speaking) {
          window.GreenoSpeech.stop("barge-in");
          if (walker) walker.talking = false;
        }
        setMouth("listen");
        if (mode !== "debrief") setState("listening", { force: true });
      },

      speechStop: () => setMouth("closed"),

      // Words appear as they are said, so there is never a silent gap where you
      // wonder whether it heard you.
      partial: (text) => { if (mode !== "debrief" && text) liveCaption(text); else if (text) $("nf-rec-meta").textContent = text.slice(-58); },

      final: (text) => { onPhrase(text); },

      error: (message) => {
        stopVoice("error");
        say("I could not hear you", message, [{ label: "OK", onClick: rest }], { state: "long", speak: false });
      },

      closed: () => { setMouth("closed"); if (walker) walker.voiceActive = false; },
    });

    if (!ok) { mode = null; clearInterval(recTimer); }
    return ok;
  }

  function stopVoice(reason = "manual") {
    clearInterval(recTimer);
    window.GreenoRealtime.stop(reason);
    mode = null;
    setMouth("closed");
    if (walker) walker.voiceActive = false;
  }

  async function onPhrase(text) {
    if (!text) return;

    // He hears himself through the microphone. Echo cancellation catches most of
    // it; this catches the rest.
    if (window.GreenoSpeech.isSelfEcho(text)) return;

    if (mode === "debrief") {
      debriefParts.push(text);
      $("nf-rec-meta").textContent = text.slice(-58);
      return;
    }

    // Chat: one finished phrase is one turn.
    if (walker) walker.thinking = true;
    setState("thinking", { force: true });
    showSurface("say");
    $("nf-say-label").textContent = "Thinking";
    $("nf-say-text").replaceChildren();
    $("nf-say-actions").innerHTML = "";

    try {
      const out = await window.greeno.ask({
        text: chatSeed ? `${text}\n\n(About your suggestion: ${chatSeed})` : text,
        medium: "voice",
        history: history.slice(-8),
      });
      chatSeed = "";

      if (out.kind === "did") {
        if (walker) walker.setMood("hyped");
        say("Done", out.say, [{ label: "OK", onClick: rest }], { state: "short" });
      } else if (out.kind === "failed") {
        say("I could not", out.say, [{ label: "OK", onClick: rest }], { state: "long", speak: false });
      } else if (out.kind === "confirm") {
        say("Just checking", out.say, [
          { label: "No", onClick: rest },
          { label: "Go ahead", primary: true, onClick: async () => {
            try {
              await window.greeno.perform({ action: out.action, args: out.args });
              say("Done", "Done.", [{ label: "OK", onClick: rest }], { state: "short" });
            } catch (err) {
              say("I could not", String(err.message || err), [{ label: "OK", onClick: rest }], { state: "long", speak: false });
            }
          } },
        ], { state: "long" });
      } else {
        history.push({ role: "user", content: text }, { role: "assistant", content: out.reply });
        if (walker) walker.setMood(out.moment === "streak" ? "hyped" : out.moment === "ghosted" ? "dramatic" : "idle");
        say("Greeno", out.reply, [{ label: "Done", onClick: () => { stopVoice("done"); rest(); } }], { state: "long" });
      }
    } catch (err) {
      say("Greeno", `That did not go through. ${String(err.message || err)}`, [{ label: "OK", onClick: rest }], { state: "long", speak: false });
    } finally {
      if (walker) walker.thinking = false;
    }
  }

  async function finishDebrief() {
    const transcript = debriefParts.join(" ").trim();
    stopVoice("debrief_done");

    if (!transcript) {
      say("Debrief", "I did not catch anything.", [{ label: "OK", onClick: rest }], { state: "short", speak: false });
      return;
    }

    if (walker) walker.thinking = true;
    setState("thinking", { force: true });
    showSurface("say");
    $("nf-say-label").textContent = "One second";
    $("nf-say-text").replaceChildren(document.createTextNode("Writing that down."));
    $("nf-say-actions").innerHTML = "";

    try {
      const out = await window.greeno.debrief({ transcript });
      // The bars fill WHILE he is still reacting. The socket is wired before the
      // persistence for exactly this reason.
      window.greeno.toBook({ type: "debrief", updates: out.updates, day: out.day });
      if (walker) walker.setMood(out.mood === "good" || out.mood === "proud" ? "hyped" : out.mood === "rough" ? "dramatic" : "idle");
      say("How it went", out.reaction, [
        { label: "Night", onClick: rest },
        { label: "See the week", primary: true, onClick: () => { window.greeno.openBook({ route: "notebook" }); rest(); } },
      ], { state: "long" });
    } catch (err) {
      say("Debrief", `That did not go through. ${String(err.message || err)}`, [{ label: "OK", onClick: rest }], { state: "long", speak: false });
    } finally {
      if (walker) walker.thinking = false;
    }
  }

  $("nf-rec-stop").addEventListener("click", finishDebrief);

  // Double-Option opens the lane and closes it. While it is open you simply
  // talk, and you may talk over him.
  window.greeno.onHotkey(() => {
    if (mode === "debrief") return finishDebrief();
    if (mode === "chat") { stopVoice("hotkey"); rest(); return; }
    if (window.GreenoSpeech.speaking) window.GreenoSpeech.stop("barge-in");
    startVoice("chat");
  });

  window.greeno.onHotkeyNeedsPermission(() => {
    say("One permission", "I need Accessibility to catch a double tap on Option. System Settings, Privacy and Security, Accessibility.", [
      { label: "Later", onClick: rest },
      { label: "Open it", primary: true, onClick: () => {
        window.greeno.openExternal({ url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" });
        rest();
      } },
    ], { state: "long", speak: false });
  });

  // ── boot ─────────────────────────────────────────────────────────────────
  window.greeno.onBoot(({ ttsPort, ttsToken }) => {
    window.GreenoSpeech.configure(ttsPort, ttsToken);
  });

  (async () => {
    const s = await window.greeno.state();
    window.GreenoSpeech.configure(s.ttsPort, s.ttsToken);

    walker = window.GreenoWalker.mount($("walk-lane"), {
      x: window.innerWidth / 2 - 32,
      y: 150,
      // He does not roam until the boot lets him out.
      roam: false,
      // Pick him up, drop him anywhere, double click to make him bigger.
      onInteractive: (on) => { wants.walker = on; syncInteractive(); },
      onGrab: () => flash("Drag me anywhere."),
      onDrop: () => flash("Starting from here."),
      onResize: (scale) => flash(scale === 1 ? "Back to small." : `Size ${scale} of 5.`),
    });

    showSurface("core");
    setState("idle", { force: true });

    // He boots before anything else happens. The full performance is for the
    // first run; after that he keeps it to a wake.
    await runBoot({ full: !s.approved });
  })();
})();
