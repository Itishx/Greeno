import React, { useEffect, useRef, useState } from "react";
import { api, tz, speak, stopSpeech, createRecorder, emphasise } from "./lib.jsx";
import Greeno from "./Greeno.jsx";

// Which section each answer mostly feeds, so the panel lights up the part it is
// about to fill while you are still answering.
const SECTION = ["routines", "habits", "focus", "focus", "routines"];
const STEPS = ["A normal day", "What slips", "Deep work", "What you listen to", "What you wish"];

export default function Onboarding({ state, onDone, onQuit }) {
  const [qi, setQi] = useState(0);
  const [phase, setPhase] = useState("ask");      // ask | readback | done
  const [answers, setAnswers] = useState([]);
  const [book, setBook] = useState(null);
  const [heard, setHeard] = useState("");
  const [busy, setBusy] = useState("");
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [fresh, setFresh] = useState(new Set());
  const rec = useRef(null);
  const mime = useRef("");
  const lastSig = useRef(new Map());

  const asked = state.askedDisplay || state.asked || [];
  const spoken = state.asked || [];

  useEffect(() => {
    if (phase !== "ask") return;
    setHeard(answers[qi] || "");
    setTyping(false);
    speak(spoken[qi]);
    return stopSpeech;
  }, [qi, phase]);

  useEffect(() => {
    if (phase !== "readback") return;
    speak("Here is what I got. Have a read. If it is right, hit looks right and I will start using it.");
    return stopSpeech;
  }, [phase]);

  // ── answering ────────────────────────────────────────────────────────────
  async function toggleMic() {
    if (busy) return;
    if (recording) {
      setRecording(false);
      setBusy("Getting that down");
      try {
        const text = await rec.current.stopAndTranscribe(mime.current);
        if (!text) { setBusy(""); setHeard(""); return; }
        setHeard(text);
        await accept(text);
      } catch (err) { setBusy(""); setHeard(String(err.message)); }
      return;
    }
    stopSpeech();
    rec.current = createRecorder();
    try {
      mime.current = await rec.current.start(setLevel);
      setRecording(true);
      setHeard("");
    } catch (err) { setHeard(`I cannot reach the microphone. ${err.message}`); }
  }

  async function accept(text) {
    const next = [...answers];
    next[qi] = text;
    setAnswers(next);
    setBusy("Writing that down");
    try {
      // Re-run the summarizer on everything said so far. Five short calls beat
      // an incremental diff, which is a category of bug you do not want in a demo.
      const nb = await api("yap", { answers: next, timezone: tz() });
      setFresh(diff(nb, lastSig.current));
      setBook(nb);
    } catch (err) { setHeard(`${text}\n\n(I could not write that down: ${err.message})`); }
    setBusy("");
  }

  function submitTyped() {
    const text = draft.trim();
    setTyping(false);
    setDraft("");
    if (!text) return;
    setHeard(text);
    accept(text);
  }

  async function next() {
    if (busy) return;
    if (phase === "ask") {
      if (qi < 4) return setQi(qi + 1);
      if (!book) {
        setBusy("Writing it all down");
        try { setBook(await api("yap", { answers, timezone: tz() })); } catch { /* show what we have */ }
        setBusy("");
      }
      return setPhase("readback");
    }
    if (phase === "readback") {
      setBusy("Saving");
      try {
        await api("notebook", { notebook: book, approved: true });
        stopSpeech();
        onDone();
      } catch (err) { setBusy(""); setHeard(String(err.message)); }
    }
  }

  const answered = Boolean(answers[qi]);
  const label = phase === "readback" ? "Read-back" : `Question ${qi + 1} of 5`;
  const headline = phase === "readback" ? "Here is *what I got*." : (asked[qi] || "");

  return (
    <div className="ob">
      {/* He asks. */}
      <section className="ob-rail">
        <header className="ob-mark">
          <span className="ob-mark-badge"><Greeno size={26} /></span>
          <span>
            <span className="ob-mark-name">Greeno</span>
            <span className="ob-mark-sub">{busy || (recording ? "Listening" : "Learning who you are")}</span>
          </span>
        </header>

        <div className="ob-q">
          <div className="ob-q-label">{label}</div>
          <h2 className="display ob-q-text">{emphasise(headline)}</h2>

          {heard && <div className={`ob-heard${recording ? " is-live" : ""}`}>{heard}</div>}

          {phase === "ask" && !typing && (
            <div className="ob-mic-row">
              <button
                className={`ob-mic${recording ? " is-live" : ""}`}
                style={recording ? { "--pulse": `${6 + level * 22}px` } : undefined}
                onClick={toggleMic}
                disabled={Boolean(busy)}
                aria-label="Answer out loud"
              >
                <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  <path d="M12 17.5V21" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
              </button>
              <div className="ob-ways">
                <div className="ob-hint">
                  {recording ? "Listening. Hit it again when you are done."
                    : answered ? "Answered. Hit the mic to redo it."
                    : "Hit the mic and just talk."}
                </div>
                <button className="ob-type-toggle" onClick={() => { stopSpeech(); setTyping(true); setDraft(answers[qi] || ""); }}>
                  or type it instead
                </button>
              </div>
            </div>
          )}

          {phase === "ask" && typing && (
            <div className="ob-typer">
              <textarea
                autoFocus rows={4} value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitTyped(); }
                  if (e.key === "Escape") setTyping(false);
                }}
                placeholder="Type your answer. Cmd + Enter when you are done."
              />
              <div className="ob-typer-row">
                <button className="ob-type-toggle" onClick={() => setTyping(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={submitTyped}>Done</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="ob-steps">
            {STEPS.map((title, i) => (
              <div key={title} className={`ob-step${answers[i] ? " is-done" : ""}${phase === "ask" && qi === i ? " is-now" : ""}`}>
                <span className="ob-step-dot" />
                <span>{title}</span>
              </div>
            ))}
          </div>
          <div className="ob-rail-foot">
            <button className="ob-link" onClick={() => (phase === "readback" ? setPhase("ask") : qi > 0 ? setQi(qi - 1) : onQuit())}>
              ← Back
            </button>
            <button className="ob-link" onClick={() => (qi < 4 ? setQi(qi + 1) : setPhase("readback"))}>Skip this one</button>
          </div>
        </div>
      </section>

      {/* It gets written down. */}
      <NotebookPanel
        book={book} fresh={fresh}
        focusOn={phase === "ask" ? SECTION[qi] : null}
        phase={phase}
        busy={busy}
        onNext={next}
        nextLabel={phase === "readback" ? "Looks right" : qi === 4 ? "See what I got" : "Continue"}
        nextDisabled={Boolean(busy) || (phase === "ask" && !answered)}
      />
    </div>
  );
}

// ── the panel ──────────────────────────────────────────────────────────────
function rowsFor(section, book) {
  if (!book) return [];
  if (section === "routines") {
    return [
      ...(book.routines || []).map((r) => ({ key: `r:${r.id}`, title: r.label, meta: `${(r.days || []).join(" ")} · ${r.start}-${r.end}` })),
      ...(book.automations || []).map((a) => ({ key: `a:${a.id}`, title: a.title, why: a.detail, meta: a.status === "wished" ? "wished for" : a.trigger })),
    ];
  }
  if (section === "habits") {
    return [
      ...(book.habits || []).map((h) => ({ key: `h:${h.id}`, title: h.title, why: h.why, meta: `${h.target} ${h.unit} · ${h.cadence}` })),
      ...(book.slipping || []).map((s, i) => ({ key: `s:${i}`, title: s, meta: "keeps slipping" })),
    ];
  }
  const out = [];
  (book.focus?.deepWork || []).forEach((w, i) => out.push({ key: `d:${i}`, title: "Deep work", meta: `${(w.days || []).join(" ")} · ${w.start}-${w.end}` }));
  (book.focus?.distractions || []).forEach((d, i) => out.push({ key: `x:${i}`, title: d, meta: "pulls you out" }));
  const m = book.focus?.music;
  if (m && (m.mood || m.playlist)) out.push({ key: "m", title: m.playlist || m.mood, why: m.playlist && m.mood ? m.mood : "", meta: m.service !== "none" ? m.service : "music" });
  return out;
}

// Animate on CHANGE, not on render, or the whole panel strobes every answer.
function diff(book, sigs) {
  const fresh = new Set();
  for (const section of ["routines", "habits", "focus"]) {
    for (const r of rowsFor(section, book)) {
      const sig = `${r.title}|${r.why || ""}|${r.meta}`;
      if (sigs.get(r.key) !== sig) fresh.add(r.key);
      sigs.set(r.key, sig);
    }
  }
  return fresh;
}

const EMPTY = {
  routines: "Nothing yet. Tell me how a normal day goes.",
  habits: "Nothing yet. Tell me what keeps slipping.",
  focus: "Nothing yet. Tell me when your head is clear.",
};

function NotebookPanel({ book, fresh, focusOn, phase, busy, onNext, nextLabel, nextDisabled }) {
  const total = ["routines", "habits", "focus"].reduce((n, s) => n + rowsFor(s, book).length, 0);
  return (
    <section className="ob-book">
      <header className="ob-book-head">
        <div>
          <h1 className="display ob-book-title">{phase === "readback" ? "Here is what I got" : "Your notebook"}</h1>
          <p className="ob-book-sub">
            {phase === "readback"
              ? "Everything below came out of what you just told me. Nothing is invented."
              : total
                ? "This is you, in your own words. Keep going and it keeps filling."
                : "Empty for now. It fills in while you talk, and nothing saves until you approve it."}
          </p>
        </div>
        {total > 0 && <div className="ob-book-count">{total} things I know about you</div>}
      </header>

      <div className="ob-book-scroll">
        {[["routines", "the shape your day already has"],
          ["habits", "what I will hold you to"],
          ["focus", "when your head is clear, and what breaks it"]].map(([sec, note]) => {
          const rows = rowsFor(sec, book);
          return (
            <section key={sec} className={`ob-sec${focusOn === sec ? " is-focused" : ""}`}>
              <div className="ob-sec-head">
                <span className="badge">{sec}</span>
                <span className="ob-sec-note">{note}</span>
              </div>
              <div className="ob-rows">
                {rows.length === 0
                  ? <div className="ob-empty">{EMPTY[sec]}</div>
                  : rows.map((r) => (
                      <div key={r.key} className={`ob-row${fresh.has(r.key) ? " is-new" : ""}`}>
                        <div>
                          <div className="ob-row-title">{r.title}</div>
                          {r.why && <div className="ob-row-why">{r.why}</div>}
                        </div>
                        <div className="ob-row-meta">{r.meta}</div>
                      </div>
                    ))}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="ob-book-foot">
        <span className="ob-foot-note">
          {busy ? `${busy}…` : phase === "readback" ? "Approving it is what turns me on." : "Nothing saves until you approve it."}
        </span>
        <button className="btn btn-primary" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>
      </footer>
    </section>
  );
}
