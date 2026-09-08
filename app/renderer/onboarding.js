// His first day on the job.
//
// Braino asks on the rail, the notebook builds in the card. The whole flow is
// voice: there are no typed forms in the happy path, and the one typed fallback
// is there because a dead microphone during a demo should not end the story.

(() => {
  const $ = (id) => document.getElementById(id);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const el = {
    qLabel: $("q-label"), qText: $("q-text"), qHint: $("q-hint"),
    heard: $("heard"), micRow: $("mic-row"), mic: $("mic"), micHint: $("mic-hint"),
    steps: $("steps"), back: $("back"), help: $("help"),
    typer: $("typer"), typeBox: $("type-box"), typeToggle: $("type-toggle"),
    typeDone: $("type-done"), typeCancel: $("type-cancel"),
    bookTitle: $("book-title"), bookSub: $("book-sub"), bookCount: $("book-count"),
    bookScroll: $("book-scroll"), footNote: $("foot-note"),
    skip: $("skip"), next: $("next"), railSub: $("rail-sub"),
    mouthIdle: $("rail-mouth-idle"), mouthListen: $("rail-mouth-listen"), mouthTalk: $("rail-mouth-talk"),
  };

  const state = {
    phase: "wake",           // wake | ask | readback | handoff | service
    qi: 0,
    questions: [], asked: [], askedDisplay: [],
    answers: [],
    notebook: null,
    lastSig: new Map(),      // row key -> signature, so only real changes animate
    recorder: null,
    recording: false,
    busy: false,
    wakeDone: false,
    hasTts: false,
  };

  // *phrase* becomes italic. Built from text nodes rather than innerHTML,
  // because the only safe thing to do with someone's own words is not parse them.
  function setEmphasised(el, marked) {
    el.replaceChildren();
    String(marked || "").split(/(\*[^*]+\*)/).forEach((part) => {
      if (!part) return;
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        const em = document.createElement("em");
        em.className = "em";
        em.textContent = part.slice(1, -1);
        el.appendChild(em);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  // ── his face on the rail ──────────────────────────────────────────────────
  function setMouth(m) {
    el.mouthIdle.style.display = m === "idle" ? "" : "none";
    el.mouthListen.style.display = m === "listen" ? "" : "none";
    el.mouthTalk.style.display = m === "talk" ? "" : "none";
  }

  async function say(text) {
    if (!text) return;
    el.railSub.textContent = "Talking";
    setMouth("talk");
    walker && (walker.speaking = true);
    try {
      if (state.hasTts) await window.GreenoSpeech.speak(text);
    } catch { /* a silent Braino is survivable; a stuck one is not */ }
    walker && (walker.speaking = false);
    setMouth("idle");
    el.railSub.textContent = "First day on the job";
  }

  // ── the stepper ───────────────────────────────────────────────────────────
  const STEP_TITLES = ["A normal day", "What slips", "Deep work", "What you listen to", "What you wish"];

  function renderSteps() {
    el.steps.innerHTML = "";
    STEP_TITLES.forEach((title, i) => {
      const answered = Boolean(state.answers[i]);
      const now = state.phase === "ask" && state.qi === i;
      const row = document.createElement("div");
      row.className = `ob-step${answered ? " is-done" : ""}${now ? " is-now" : ""}`;
      row.innerHTML = `<span class="ob-step-dot"></span><span>${title}</span>`;
      el.steps.appendChild(row);
    });
  }

  // ── the notebook, and the diff ────────────────────────────────────────────
  // Animate on CHANGE, not on render. Without the diff the whole panel strobes
  // on every answer and the effect is gone.
  function rowsFor(section, book) {
    if (!book) return [];
    if (section === "routines") {
      const routines = (book.routines || []).map((r) => ({
        key: `r:${r.id}`,
        title: r.label,
        why: "",
        meta: `${(r.days || []).join(" ")} · ${r.start}-${r.end}`,
      }));
      const autos = (book.automations || []).map((a) => ({
        key: `a:${a.id}`,
        title: a.title,
        why: a.detail || "",
        meta: a.status === "wished" ? "wished" : a.trigger,
      }));
      return routines.concat(autos);
    }
    if (section === "habits") {
      const habits = (book.habits || []).map((h) => ({
        key: `h:${h.id}`,
        title: h.title,
        why: h.why || "",
        meta: `${h.target} ${h.unit} · ${h.cadence}`,
      }));
      const slipping = (book.slipping || []).map((s, i) => ({
        key: `s:${i}:${s}`,
        title: s,
        why: "",
        meta: "keeps slipping",
      }));
      return habits.concat(slipping);
    }
    // focus
    const out = [];
    (book.focus?.deepWork || []).forEach((w, i) => out.push({
      key: `d:${i}`,
      title: "Deep work",
      why: "",
      meta: `${(w.days || []).join(" ")} · ${w.start}-${w.end}`,
    }));
    (book.focus?.distractions || []).forEach((d, i) => out.push({
      key: `x:${i}:${d}`, title: d, why: "", meta: "pulls you out",
    }));
    const music = book.focus?.music;
    if (music && (music.mood || music.playlist)) {
      out.push({
        key: "m:music",
        title: music.playlist || music.mood,
        why: music.playlist && music.mood ? music.mood : "",
        meta: music.service && music.service !== "none" ? music.service : "music",
      });
    }
    return out;
  }

  const EMPTY_COPY = {
    routines: "Nothing yet. Tell me how a normal day goes.",
    habits: "Nothing yet. Tell me what keeps slipping.",
    focus: "Nothing yet. Tell me when your head is clear.",
  };

  function renderBook(book, { animate = true } = {}) {
    state.notebook = book;
    let changed = 0;

    for (const section of ["routines", "habits", "focus"]) {
      const host = $(`rows-${section}`);
      const rows = rowsFor(section, book);
      host.innerHTML = "";

      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "ob-empty";
        empty.textContent = EMPTY_COPY[section];
        host.appendChild(empty);
        continue;
      }

      for (const r of rows) {
        const sig = `${r.title}|${r.why}|${r.meta}`;
        const isNew = animate && state.lastSig.get(r.key) !== sig;
        if (isNew) changed++;
        state.lastSig.set(r.key, sig);

        const node = document.createElement("div");
        node.className = `ob-row${isNew ? " is-new" : ""}`;
        node.innerHTML = `
          <div class="ob-row-main">
            <div class="ob-row-title"></div>
            ${r.why ? '<div class="ob-row-why"></div>' : ""}
          </div>
          <div class="ob-row-meta"></div>`;
        node.querySelector(".ob-row-title").textContent = r.title;
        if (r.why) node.querySelector(".ob-row-why").textContent = r.why;
        node.querySelector(".ob-row-meta").textContent = r.meta;
        host.appendChild(node);
      }
    }

    const counts = {
      routines: rowsFor("routines", book).length,
      habits: rowsFor("habits", book).length,
      focus: rowsFor("focus", book).length,
    };
    const total = counts.routines + counts.habits + counts.focus;
    el.bookCount.textContent = total ? `${total} things I know about you` : "";

    // Saying "empty for now" over a full notebook is the kind of small lie that
    // makes the whole screen feel automated.
    if (state.phase !== "readback") {
      el.bookSub.textContent = total
        ? "This is you, in your own words. Keep going and it keeps filling."
        : "Empty for now. It fills in while you talk, and nothing saves until you approve it.";
    }
    return changed;
  }

  // Light the section the current question mostly feeds.
  function focusSection(section) {
    document.querySelectorAll(".ob-sec").forEach((s) => {
      s.classList.toggle("is-focused", s.dataset.sec === section);
    });
  }
  const QUESTION_SECTION = ["routines", "habits", "focus", "focus", "routines"];

  // ── recording one answer ──────────────────────────────────────────────────
  async function toggleRecord() {
    if (state.busy) return;
    if (state.recording) return stopRecord();

    try {
      await window.greeno.micPermission();
    } catch { /* the getUserMedia call below reports the real problem */ }

    state.recorder = window.GreenoSpeech.createRecorder();
    try {
      await state.recorder.start({
        onLevel: (peak) => {
          // The ring breathes with the voice, so a dead mic is visible instantly
          // rather than discovered after a minute of talking to nothing.
          el.mic.style.setProperty("--pulse", `${6 + peak * 22}px`);
        },
      });
    } catch (err) {
      el.micHint.innerHTML = `I cannot reach the microphone. <b>${String(err.message || err)}</b>`;
      return;
    }

    state.recording = true;
    el.mic.classList.add("is-live");
    el.heard.classList.add("is-live");
    el.heard.textContent = "";
    el.micHint.innerHTML = "Listening. Hit it again when you are done.";
    el.railSub.textContent = "Listening";
    setMouth("listen");
    if (walker) walker.voiceActive = true;
  }

  async function stopRecord() {
    if (!state.recording) return;
    state.recording = false;
    el.mic.classList.remove("is-live");
    el.heard.classList.remove("is-live");
    el.mic.style.removeProperty("--pulse");
    setMouth("idle");
    if (walker) walker.voiceActive = false;

    setBusy(true, "Getting that down");
    try {
      const blob = await state.recorder.stopAndGet();
      const buf = await blob.arrayBuffer();
      const text = await window.greeno.transcribe({ buffer: buf, mimeType: blob.type });
      if (!text) {
        el.micHint.textContent = "I did not catch anything. Try again?";
        setBusy(false);
        return;
      }
      el.heard.textContent = text;
      await acceptAnswer(text);
    } catch (err) {
      el.micHint.innerHTML = `That did not go through. <b>${String(err.message || err)}</b>`;
    } finally {
      setBusy(false);
    }
  }

  // ── the loop that makes the panel fill ────────────────────────────────────
  async function acceptAnswer(text) {
    state.answers[state.qi] = text;
    renderSteps();

    setBusy(true, "Working that out");
    el.railSub.textContent = "Thinking";
    if (walker) walker.thinking = true;
    try {
      // Re-run the summarizer on everything said so far. Five short calls with
      // effort "none" beat an incremental diff, which is a category of bug you
      // do not need during a demo.
      const book = await window.greeno.yap({ answers: state.answers, timezone: tz });
      renderBook(book);
    } catch (err) {
      el.bookSub.textContent = `I could not write that down. ${String(err.message || err)}`;
    } finally {
      if (walker) walker.thinking = false;
      el.railSub.textContent = "First day on the job";
      setBusy(false);
    }

    el.micHint.innerHTML = "Got it. <b>Continue</b> when you are ready.";
    el.next.disabled = false;
  }

  function setBusy(on, label) {
    state.busy = on;
    el.mic.disabled = on;
    el.next.disabled = on || (state.phase === "ask" && !state.answers[state.qi]);
    if (on && label) el.micHint.textContent = `${label}…`;
  }

  // ── the phases ────────────────────────────────────────────────────────────
  function renderWake() {
    state.phase = "wake";
    if (el.typer) el.typer.hidden = true;
    el.qLabel.textContent = "How this works";
    // He introduced himself in the notch already. Saying it again is the fastest
    // way to look like two disconnected screens instead of one someone.
    setEmphasised(el.qText, "All you have to do is *talk*.");
    el.qHint.textContent = "Tell me who you are, what you do, and what a normal day looks like. I build your tracker on the right while you speak. No forms, nothing to fill in.";
    el.micRow.hidden = true;
    el.heard.textContent = "";
    el.bookTitle.textContent = "Your notebook";
    el.bookSub.textContent = "Empty for now. It fills in while you talk, and nothing saves until you approve it.";
    el.next.textContent = "Alright, ask me";
    el.next.disabled = false;
    el.skip.hidden = false;
    el.skip.textContent = "Skip the tour";
    el.help.textContent = "How do I reach you?";
    focusSection(null);
    renderSteps();
    say("Right. All you have to do is talk. Tell me who you are, what you do, and what your day actually looks like, and I will build your tracker live in front of you while you speak.");
  }

  function renderQuestion() {
    state.phase = "ask";
    closeTyper();
    const i = state.qi;
    el.qLabel.textContent = `Question ${i + 1} of 5`;
    setEmphasised(el.qText, state.askedDisplay[i] || state.asked[i] || state.questions[i]);
    el.qHint.textContent = "";
    el.micRow.hidden = false;
    el.heard.textContent = state.answers[i] || "";
    el.micHint.innerHTML = state.answers[i]
      ? "Answered. Hit the mic to redo it, or <b>Continue</b>."
      : "Hit the mic and just talk. <b>No forms.</b>";
    el.next.textContent = i === 4 ? "See what I got" : "Continue";
    el.next.disabled = !state.answers[i];
    el.skip.hidden = false;
    el.skip.textContent = "Skip this one";
    focusSection(QUESTION_SECTION[i]);
    renderSteps();
    say(state.asked[i]);
  }

  function renderReadback() {
    state.phase = "readback";
    closeTyper();
    el.qLabel.textContent = "Read-back";
    setEmphasised(el.qText, "Here is *what I got*.");
    el.qHint.textContent = "Read it. If it is wrong anywhere, tell me and I will fix it. If it is right, say so and I will start using it.";
    el.micRow.hidden = false;
    el.heard.textContent = "";
    el.micHint.innerHTML = "Hit the mic to correct something, or <b>Looks right</b>.";
    el.bookTitle.textContent = "Here is what I got";
    el.bookSub.textContent = "Everything below came out of what you just told me. Nothing is invented.";
    el.next.textContent = "Looks right";
    el.next.className = "btn btn-primary no-drag";
    el.next.disabled = false;
    el.skip.hidden = false;
    el.skip.textContent = "Back to the questions";
    el.footNote.textContent = "This stays on your Mac. Approving it is what turns me on.";
    focusSection(null);
    renderSteps();
    say("Here is what I got. Have a read. If it is right, hit looks right and I will start using it.");
  }

  function renderService() {
    state.phase = "service";
    if (el.typer) el.typer.hidden = true;
    const book = state.notebook;
    const hour = new Date().getHours();
    const first = hour < 12
      ? "Right. Tomorrow morning I will drop in with what your day actually looks like."
      : hour < 18
        ? "Right. Want me to hold your next deep work block?"
        : "Right. Tonight I will ask how it went, and tomorrow morning I will open your day.";

    el.qLabel.textContent = "One more thing";
    setEmphasised(el.qText, "I am *on*.");
    el.qHint.textContent = first;
    el.micRow.hidden = true;
    el.heard.textContent = "";
    el.bookTitle.textContent = "Your notebook";
    el.bookSub.textContent = `I will show up three times: when your day starts at ${book?.startTime || "08:30"}, when you look stuck, and at night.`;
    el.next.textContent = "Let him work";
    el.next.className = "btn btn-primary no-drag";
    el.skip.hidden = true;
    el.help.textContent = "Open the notebook";
    focusSection(null);
    say(`${first} Anything you need before then, tap Option twice.`);
  }

  // ── navigation ────────────────────────────────────────────────────────────
  async function next() {
    if (state.busy) return;

    if (state.phase === "wake") { state.qi = 0; renderQuestion(); return; }

    if (state.phase === "ask") {
      if (state.qi < 4) { state.qi++; renderQuestion(); return; }
      // Last answer is in. Make sure the notebook reflects all five before the
      // read-back, since the read-back is where the 99% is actually measured.
      if (!state.notebook) {
        setBusy(true, "Writing it all down");
        try {
          renderBook(await window.greeno.yap({ answers: state.answers, timezone: tz }));
        } catch { /* the read-back will show whatever we have */ }
        setBusy(false);
      }
      renderReadback();
      return;
    }

    if (state.phase === "readback") {
      setBusy(true, "Saving");
      try {
        await window.greeno.saveNotebook({ notebook: state.notebook, approved: true });
        renderService();
      } catch (err) {
        el.qHint.textContent = `I could not save that. ${String(err.message || err)}`;
      } finally {
        setBusy(false);
      }
      return;
    }

    if (state.phase === "service") { window.greeno.closeBook(); }
  }

  function back() {
    if (state.busy) return;
    if (state.phase === "ask" && state.qi > 0) { state.qi--; renderQuestion(); return; }
    if (state.phase === "ask") { renderWake(); return; }
    if (state.phase === "readback") { state.qi = 4; renderQuestion(); return; }
  }

  function skip() {
    if (state.phase === "wake") { state.qi = 0; renderQuestion(); return; }
    if (state.phase === "ask") {
      if (state.qi < 4) { state.qi++; renderQuestion(); }
      else renderReadback();
      return;
    }
    if (state.phase === "readback") { state.qi = 4; renderQuestion(); }
  }

  // ── typing ────────────────────────────────────────────────────────────────
  function openTyper() {
    el.typer.hidden = false;
    el.micRow.hidden = true;
    el.typeBox.value = state.answers[state.qi] || "";
    el.typeBox.focus();
  }
  function closeTyper() {
    el.typer.hidden = true;
    if (state.phase === "ask" || state.phase === "readback") el.micRow.hidden = false;
  }
  async function submitTyped() {
    const text = el.typeBox.value.trim();
    closeTyper();
    if (!text) return;
    el.heard.textContent = text;
    await acceptAnswer(text);
  }

  // The old typed fallback, kept for the read-back where corrections are spoken.
  function typeInstead() {
    if (state.phase === "service") { window.greeno.openBook({ route: "notebook" }); return; }
    if (state.phase === "wake") {
      el.qHint.textContent = "Tap Control twice, anywhere on this Mac, and I wake up. Option twice does the same. Try it now if you like.";
      return;
    }
    const text = window.prompt(state.asked[state.qi] || "Tell me:");
    if (text && text.trim()) {
      el.heard.textContent = text.trim();
      acceptAnswer(text.trim());
    }
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  let walker = null;

  async function boot() {
    const s = await window.greeno.state();
    state.questions = s.questions;
    state.asked = s.asked;
    state.askedDisplay = s.askedDisplay || s.asked;
    state.hasTts = Boolean(s.hasFish || s.hasOpenAI);
    window.GreenoSpeech.configure(s.ttsPort, s.ttsToken);

    if (!s.hasOpenAI) {
      el.bookSub.innerHTML = "No OPENAI_API_KEY yet. Copy <b>.env.example</b> to <b>.env</b>, fill it in, and restart.";
      el.footNote.textContent = "Waiting on a key.";
    }

    // Deliberately no mascot here. There is exactly one Greeno, and he lives in
    // the notch window, which floats above this one. Mounting a second walker
    // gave you two of him the moment this window opened.

    el.mic.addEventListener("click", toggleRecord);
    el.next.addEventListener("click", next);
    el.back.addEventListener("click", back);
    el.skip.addEventListener("click", skip);
    el.help.addEventListener("click", typeInstead);
    el.typeToggle.addEventListener("click", openTyper);
    el.typeDone.addEventListener("click", submitTyped);
    el.typeCancel.addEventListener("click", closeTyper);
    el.typeBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitTyped(); }
      if (e.key === "Escape") { e.preventDefault(); closeTyper(); }
    });

    // Space bar is the mic while a question is up. Hands stay off the trackpad.
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.repeat && state.phase === "ask" && el.typer.hidden
          && document.activeElement === document.body) {
        e.preventDefault();
        toggleRecord();
      }
      if (e.key === "Enter" && !state.busy && !el.next.disabled
          && document.activeElement !== el.typeBox) next();
    });

    // He teaches double-Option by making them try it, and the wake step does not
    // advance on its own until they have.
    window.greeno.onHotkey(() => {
      if (state.phase !== "wake" || state.wakeDone) return;
      state.wakeDone = true;
      setEmphasised(el.qText, "That is it. That is *how you reach me*.");
      el.qHint.textContent = "Control twice, any time, anywhere on this Mac.";
      say("That is it. Any time, anywhere.");
    });

    renderWake();
    renderBook(null, { animate: false });
  }

  boot();
})();
