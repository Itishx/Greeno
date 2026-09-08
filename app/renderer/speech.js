// Him talking, and him shutting up.
//
// Three ideas, all load-bearing:
//   1. Split into sentences and fetch one at a time. First audio then costs one
//      short sentence, not the whole reply.
//   2. Prefetch the next sentence while the current one plays. N+1 look-ahead,
//      at most one fetch in flight. Any more and Fish rate-limits you.
//   3. A generation token. Every speech job carries a number. Bump it and every
//      in-flight callback checks itself out. This is what makes barge-in instant
//      instead of "instant after the fetch times out".
(function () {
  let generation = 0;
  let currentAudio = null;
  const abortControllers = new Set();
  let remainder = "";
  let isSpeaking = false;
  let bridge = { port: 0, token: "" };
  const listeners = { start: [], end: [], audio: [] };

  // He hears himself through the mic and treats it as a command. Every line he
  // speaks gets registered BEFORE it plays.
  const recentlySpoken = [];
  const normalize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  function noteSpoken(text) {
    recentlySpoken.push({ text: normalize(text), at: Date.now() });
    while (recentlySpoken.length > 8) recentlySpoken.shift();
  }

  function isSelfEcho(heard) {
    const h = normalize(heard);
    if (!h) return false;
    const now = Date.now();
    return recentlySpoken.some((s) => now - s.at < 15000 && (s.text.includes(h) || h.includes(s.text)));
  }

  function configure(port, token) { bridge = { port, token }; }

  function stripMarkdownForSpeech(text) {
    return String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^[#>\-*]\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Short sentences first, so the first audio arrives fast. Very short fragments
  // are glued onto the next one, because a 3-word request costs a whole round
  // trip for almost no audio.
  function splitSentencesForTts(text) {
    const rough = String(text).match(/[^.!?\n]+[.!?]*/g) || [text];
    const out = [];
    for (const piece of rough.map((s) => s.trim()).filter(Boolean)) {
      if (out.length && (out[out.length - 1].length < 24 || piece.length < 24)) {
        out[out.length - 1] = `${out[out.length - 1]} ${piece}`.trim();
      } else {
        out.push(piece);
      }
    }
    return out.length ? out : [text];
  }

  function ttsUrl(sentence) {
    const u = new URL(`http://127.0.0.1:${bridge.port}/tts`);
    u.searchParams.set("token", bridge.token);
    u.searchParams.set("text", sentence);
    return u.toString();
  }

  async function fetchSentence(sentence, token) {
    const ctl = new AbortController();
    abortControllers.add(ctl);
    try {
      const resp = await fetch(ttsUrl(sentence), { signal: ctl.signal });
      if (token !== generation) return { error: "stale" };
      if (!resp.ok) return { error: `tts ${resp.status}` };
      return { resp };
    } catch (err) {
      return { error: err?.name === "AbortError" ? "aborted" : String(err.message || err) };
    } finally {
      abortControllers.delete(ctl);
    }
  }

  async function playSentence(resp, token, sentenceText) {
    const blob = await resp.blob();
    if (token !== generation) return false;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    audio.addEventListener("play", () => { isSpeaking = true; emit("start"); });
    // Hand the element out BEFORE play, so a listener can attach its own
    // "playing" hook and start painting on the first frame of audio.
    emitAudio(audio, sentenceText, token);
    const done = new Promise((resolve) => {
      audio.addEventListener("ended", () => resolve(true), { once: true });
      audio.addEventListener("error", () => resolve(false), { once: true });
    });

    try {
      await audio.play();
    } finally {
      // Freed on every path. A leaked object URL per sentence is a slow leak
      // that only shows up in a long session, which is exactly a demo.
      done.finally(() => URL.revokeObjectURL(url));
    }
    const ok = await done;
    if (currentAudio === audio) { currentAudio = null; isSpeaking = false; emit("end"); }
    return ok;
  }

  // Warm one line ahead of time. Used by the boot, where there are four seconds
  // of animation to spend and no reason to pay for the fetch afterwards.
  const warmed = new Map();
  async function prefetch(text) {
    const clean = stripMarkdownForSpeech(text);
    if (!clean || !bridge.port || warmed.has(clean)) return;
    try {
      const resp = await fetch(ttsUrl(clean));
      if (resp.ok) warmed.set(clean, await resp.blob());
    } catch { /* the normal path will just fetch it again */ }
  }

  async function speak(text) {
    const clean = stripMarkdownForSpeech(text);
    if (!clean) return false;
    if (!bridge.port) return false;

    // Tell the self-echo filter what he is about to say. Any spoken line the
    // filter does not know about comes back in through the mic as a command.
    noteSpoken(clean);

    stop("new utterance");
    const token = ++generation;

    // Already warmed? Play it straight from memory.
    const ready = warmed.get(clean);
    if (ready) {
      warmed.delete(clean);
      const url = URL.createObjectURL(ready);
      const audio = new Audio(url);
      currentAudio = audio;
      audio.addEventListener("play", () => { isSpeaking = true; emit("start"); });
      emitAudio(audio, clean, token);
      const done = new Promise((r) => {
        audio.addEventListener("ended", () => r(true), { once: true });
        audio.addEventListener("error", () => r(false), { once: true });
      });
      try { await audio.play(); } catch { URL.revokeObjectURL(url); return false; }
      const ok = await done;
      URL.revokeObjectURL(url);
      if (currentAudio === audio) { currentAudio = null; isSpeaking = false; emit("end"); }
      return ok;
    }
    const sentences = splitSentencesForTts(clean);
    let spoke = false;
    let pending = null;

    for (let i = 0; i < sentences.length; i++) {
      if (token !== generation) return spoke;

      // Refreshed before every sentence. If you cut him off, this is what he
      // would pick up from.
      remainder = sentences.slice(i).join(" ");

      const cur = await (pending || fetchSentence(sentences[i], token));
      pending = null;
      if (token !== generation) return spoke;
      if (cur.error) {
        if (cur.error === "aborted" || cur.error === "stale") return spoke;
        console.warn("[greeno] tts failed:", cur.error);
        return spoke;
      }

      // Start the NEXT fetch now, so it overlaps this one's playback. This is
      // the line that removes the pause between sentences.
      if (i + 1 < sentences.length) pending = fetchSentence(sentences[i + 1], token);

      try {
        if (await playSentence(cur.resp, token, sentences[i])) spoke = true;
      } catch (err) {
        if (token !== generation) return spoke;
        // NotAllowedError is the autoplay policy, not an outage. No error card.
        if (err?.name === "NotAllowedError") return spoke;
        return spoke;
      }
    }

    remainder = "";
    return spoke;
  }

  function stop(reason = "") {
    // Every "his mouth moves but nothing comes out" report has turned out to be
    // speech cancelled by something. Without this line the only way to find the
    // culprit is to guess.
    if (reason) console.log(`[greeno] speech stopped: ${reason}`);

    generation += 1;              // everything in flight is now stale

    // Abort every in-flight fetch: the playing sentence AND the prefetch.
    // Without this, barge-in waits for the network.
    for (const c of abortControllers) { try { c.abort(); } catch {} }
    abortControllers.clear();

    if (currentAudio) {
      try { currentAudio.pause(); } catch {}
      currentAudio.src = "";
      currentAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // Cleared UNCONDITIONALLY, never inside a token check. This flag used to sit
    // behind one, so a barge-in (which bumps the generation) left it stuck true
    // forever: the self-echo filter then swallowed every later turn.
    isSpeaking = false;
    emit("end");
  }

  function emit(name) { for (const fn of listeners[name]) { try { fn(); } catch {} } }
  function emitAudio(audio, text, generation) {
    for (const fn of listeners.audio) { try { fn(audio, text, generation); } catch {} }
  }
  function on(name, fn) { listeners[name]?.push(fn); }

  // ── him listening ─────────────────────────────────────────────────────────
  // On the Mac there is no MV3 restriction: capture in the renderer directly.
  function createRecorder() {
    let media = null, recorder = null, chunks = [], stream = null;
    let onLevel = null, raf = 0, audioCtx = null;

    async function start(opts = {}) {
      onLevel = opts.onLevel || null;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      chunks = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.start(250);

      if (onLevel) {
        audioCtx = new AudioContext();
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
          onLevel(peak);
          raf = requestAnimationFrame(loop);
        };
        loop();
      }
      media = mime;
      return true;
    }

    async function stopAndGet() {
      if (!recorder) return null;
      const done = new Promise((r) => recorder.addEventListener("stop", r, { once: true }));
      recorder.stop();
      await done;
      cancelAnimationFrame(raf);
      audioCtx?.close().catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: media });
      recorder = null; stream = null; audioCtx = null;
      return blob;
    }

    return { start, stopAndGet, get active() { return Boolean(recorder); } };
  }

  window.GreenoSpeech = {
    configure, speak, prefetch, stop, on, noteSpoken, isSelfEcho,
    get generation() { return generation; },
    createRecorder, splitSentencesForTts, stripMarkdownForSpeech,
    get speaking() { return isSpeaking; },
    get remainder() { return remainder; },
  };
})();
