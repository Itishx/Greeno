import React, { useEffect, useRef, useState } from "react";
import { api, tz, speak, stopSpeech, createRecorder, emphasise } from "./lib.jsx";
import Greeno from "./Greeno.jsx";

// His first day on the job.
//
// Three parts, in the order the notebook's sections appear, because an earlier
// version asked five scattered questions written for a general companion and
// left people unsure what kind of answer was wanted. Each question is short
// enough to answer out loud; the detail lives in the helper line, and one whole
// example sentence shows HOW MUCH to say.

export default function Onboarding({ state, onDone, onQuit }) {
  const parts = state.parts || [];
  const steps = parts.flatMap((p) => p.steps.map((s) => ({ ...s, section: p.section, part: p })));

  const [i, setI] = useState(0);
  const [phase, setPhase] = useState("ask");        // ask | readback
  const [answers, setAnswers] = useState({});
  const [pomodoro, setPomodoro] = useState({ work: 25, break: 5 });
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
  const sigs = useRef(new Map());

  const step = steps[i];
  const partIndex = parts.findIndex((p) => p.section === step?.section);
  // The intro is spoken once, when you arrive at a new part.
  const firstOfPart = step && step.part.steps[0].id === step.id;

  useEffect(() => {
    if (phase !== "ask" || !step) return;
    setHeard(answers[step.id] || "");
    setTyping(false);
    speak(firstOfPart ? `${step.part.intro} ${step.spoken}` : step.spoken);
    return stopSpeech;
  }, [i, phase]);

  useEffect(() => {
    if (phase !== "readback") return;
    speak("Here is what I got. Have a read. If it is right, hit looks right and I will start using it.");
    return stopSpeech;
  }, [phase]);

  if (!step && phase === "ask") return <div className="nbk-loading">One second…</div>;

  // ── answering ────────────────────────────────────────────────────────────
  async function toggleMic() {
    if (busy) return;
    if (recording) {
      setRecording(false);
      setBusy("Getting that down");
      try {
        const text = await rec.current.stopAndTranscribe(mime.current);
        if (!text) { setBusy(""); return; }
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
    const next = { ...answers, [step.id]: text };
    setAnswers(next);
    await rebuild(next, pomodoro);
  }

  async function rebuild(nextAnswers, nextPom) {
    setBusy("Writing that down");
    try {
      const nb = await api("yap", { answers: nextAnswers, timezone: tz(), pomodoro: nextPom });
      setFresh(diff(nb, sigs.current));
      setBook(nb);
    } catch (err) { setHeard((h) => `${h}\n\n(I could not write that down: ${err.message})`); }
    setBusy("");
  }

  function submitTyped() {
    const text = draft.trim();
    setTyping(false); setDraft("");
    if (!text) return;
    setHeard(text);
    accept(text);
  }

  async function pickPomodoro(choice) {
    const next = { work: choice.work, break: choice.brk };
    setPomodoro(next);
    setAnswers((a) => ({ ...a, [step.id]: choice.value }));
    if (Object.keys(answers).length) await rebuild(answers, next);
    setI(i + 1);
  }

  async function next() {
    if (busy) return;
    if (phase === "ask") {
      if (i < steps.length - 1) return setI(i + 1);
      if (!book) { await rebuild(answers, pomodoro); }
      return setPhase("readback");
    }
    setBusy("Saving");
    try {
      await api("notebook", { notebook: book, approved: true });
      stopSpeech();
      onDone();
    } catch (err) { setBusy(""); setHeard(String(err.message)); }
  }

  const answered = phase === "readback" || Boolean(answers[step?.id]);
  const isChoice = step?.mode === "choice";

  return (
    <div className="ob">
      <section className="ob-rail">
        <header className="ob-mark">
          <span className="ob-mark-badge"><Greeno size={26} /></span>
          <span>
            <span className="ob-mark-name">Greeno</span>
            <span className="ob-mark-sub">{busy || (recording ? "Listening" : "Learning who you are")}</span>
          </span>
        </header>

        <div className="ob-q">
          <div className="ob-q-label">
            {phase === "readback"
              ? "Read-back"
              : <>Part {partIndex + 1} of {parts.length} · {step.part.title}</>}
          </div>

          <h2 className="display ob-q-text">
            {emphasise(phase === "readback" ? "Here is *what I got*." : step.display)}
          </h2>

          {phase === "ask" && (
            <>
              <p className="ob-helper">{step.helper}</p>
              {step.example && !heard && (
                // One whole sentence, the way somebody would actually say it.
                // A row of chips reads as buttons and makes people hunt for the
                // "right" answer instead of just talking.
                <p className="ob-example">For example: “{step.example}”</p>
              )}
            </>
          )}

          {heard && <div className={`ob-heard${recording ? " is-live" : ""}`}>{heard}</div>}

          {phase === "ask" && isChoice && (
            <div className="ob-choices">
              {step.choices.map((c) => (
                <button
                  key={c.value}
                  className={`ob-choice${pomodoro.work === c.work ? " is-on" : ""}`}
                  onClick={() => pickPomodoro(c)}
                >
                  <b>{c.label}</b><span>{c.note}</span>
                </button>
              ))}
            </div>
          )}

          {phase !== "readback" && !isChoice && !typing && (
            <div className="ob-mic-row">
              <button
                className={`ob-mic${recording ? " is-live" : ""}`}
                style={recording ? { "--pulse": `${6 + level * 22}px` } : undefined}
                onClick={toggleMic} disabled={Boolean(busy)} aria-label="Answer out loud"
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
                <button className="ob-type-toggle" onClick={() => { stopSpeech(); setTyping(true); setDraft(answers[step.id] || ""); }}>
                  or type it instead
                </button>
              </div>
            </div>
          )}

          {phase === "ask" && typing && (
            <div className="ob-typer">
              <textarea autoFocus rows={4} value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitTyped(); }
                  if (e.key === "Escape") setTyping(false);
                }}
                placeholder={step.example ? `e.g. ${step.example}` : "Type your answer. Cmd + Enter when done."} />
              <div className="ob-typer-row">
                <button className="ob-type-toggle" onClick={() => setTyping(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={submitTyped}>Done</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="ob-steps">
            {parts.map((p, pi) => (
              <div key={p.section} className={`ob-step${pi < partIndex || phase === "readback" ? " is-done" : ""}${pi === partIndex && phase === "ask" ? " is-now" : ""}`}>
                <span className="ob-step-dot" />
                <span>{p.title}</span>
                <span className="ob-step-n">
                  {p.steps.filter((s) => answers[s.id]).length}/{p.steps.length}
                </span>
              </div>
            ))}
          </div>
          <div className="ob-rail-foot">
            <button className="ob-link" onClick={() => (phase === "readback" ? setPhase("ask") : i > 0 ? setI(i - 1) : onQuit())}>← Back</button>
            <button className="ob-link" onClick={() => (i < steps.length - 1 ? setI(i + 1) : setPhase("readback"))}>Skip this one</button>
          </div>
        </div>
      </section>

      <NotebookPanel
        book={book} fresh={fresh}
        focusOn={phase === "ask" ? step.section : null}
        phase={phase} busy={busy}
        onNext={next}
        nextLabel={phase === "readback" ? "Looks right" : i === steps.length - 1 ? "See what I got" : "Continue"}
        nextDisabled={Boolean(busy) || (phase === "ask" && !isChoice && !answered)}
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
      ...(book.habits || []).map((h) => ({
        key: `h:${h.id}`, title: h.title, why: h.why,
        meta: `${h.target} ${h.unit} · ${h.cadence}`,
        tag: h.state === "building" ? "building" : "current",
      })),
      ...(book.slipping || []).map((s, n) => ({ key: `s:${n}`, title: s, meta: "keeps slipping" })),
    ];
  }
  const out = [];
  const f = book.focus || {};
  if (f.pomodoro?.work) out.push({ key: "p", title: `${f.pomodoro.work} / ${f.pomodoro.break}`, meta: "focus block" });
  (f.deepWork || []).forEach((w, n) => out.push({ key: `d:${n}`, title: "Deep work", meta: `${(w.days || []).join(" ")} · ${w.start}-${w.end}` }));
  (f.distractions || []).forEach((d, n) => out.push({ key: `x:${n}:${d}`, title: d, meta: "breaks your focus" }));
  if (f.music && (f.music.mood || f.music.playlist)) {
    out.push({
      key: "m", title: f.music.playlist || f.music.mood,
      why: f.music.playlist && f.music.mood ? f.music.mood : "",
      meta: f.music.service && f.music.service !== "none" ? f.music.service : "music",
    });
  }
  return out;
}

// Animate on CHANGE, not on render, or the whole panel strobes every answer.
function diff(book, store) {
  const fresh = new Set();
  for (const section of ["routines", "habits", "focus"]) {
    for (const r of rowsFor(section, book)) {
      const sig = `${r.title}|${r.why || ""}|${r.meta}`;
      if (store.get(r.key) !== sig) fresh.add(r.key);
      store.set(r.key, sig);
    }
  }
  return fresh;
}

const EMPTY = {
  routines: "Nothing yet. Tell me what a normal weekday looks like.",
  habits: "Nothing yet. Tell me what you already do.",
  focus: "Nothing yet. Tell me what you listen to when you work.",
};

function NotebookPanel({ book, fresh, focusOn, phase, busy, onNext, nextLabel, nextDisabled }) {
  const SECTIONS = [
    ["habits", "what I will hold you to"],
    ["focus", "when your head is clear, and what breaks it"],
    ["routines", "the shape your day already has"],
  ];
  const [picked, setPicked] = useState(null);
  const active = picked || focusOn || "habits";
  useEffect(() => { setPicked(null); }, [focusOn]);

  const counts = Object.fromEntries(SECTIONS.map(([s]) => [s, rowsFor(s, book).length]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = rowsFor(active, book);

  return (
    <section className="ob-book">
      <header className="ob-book-head">
        <div>
          <h1 className="display ob-book-title">{phase === "readback" ? "Here is what I got" : "Your notebook"}</h1>
          <p className="ob-book-sub">
            {phase === "readback"
              ? "Everything below came out of what you just told me. Nothing is invented."
              : total ? "This is you, in your own words. Keep going and it keeps filling."
              : "Empty for now. It fills in while you talk, and nothing saves until you approve it."}
          </p>
        </div>
        {total > 0 && <div className="ob-book-count">{total} things I know about you</div>}
      </header>

      <nav className="ob-tabs">
        {SECTIONS.map(([sec]) => (
          <button key={sec}
            className={`ob-tab${active === sec ? " is-on" : ""}${focusOn === sec ? " is-filling" : ""}`}
            onClick={() => setPicked(sec)}>
            {sec[0].toUpperCase() + sec.slice(1)}
            {counts[sec] ? <span className="ob-tab-n">{counts[sec]}</span> : null}
          </button>
        ))}
      </nav>

      <div className="ob-book-scroll">
        <p className="ob-tab-note">{SECTIONS.find(([s]) => s === active)[1]}</p>
        <div className="ob-rows">
          {rows.length === 0
            ? <div className="ob-empty">{EMPTY[active]}</div>
            : rows.map((r) => (
                <div key={r.key} className={`ob-row${fresh.has(r.key) ? " is-new" : ""}`}>
                  <div>
                    <div className="ob-row-title">
                      {r.title}
                      {r.tag && <span className={`ob-tag is-${r.tag}`}>{r.tag}</span>}
                    </div>
                    {r.why && <div className="ob-row-why">{r.why}</div>}
                  </div>
                  <div className="ob-row-meta">{r.meta}</div>
                </div>
              ))}
        </div>
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
