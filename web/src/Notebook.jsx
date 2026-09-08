import React, { useEffect, useState } from "react";
import { api, emphasise, speak, stopSpeech, createRecorder } from "./lib.jsx";
import Greeno from "./Greeno.jsx";

const TABS = [
  ["routines", "the shape your day already has"],
  ["habits", "what he holds you to"],
  ["focus", "when your head is clear, and what breaks it"],
  ["setup", "when he shows up, and what is coming next"],
];

export default function Notebook({ onRedo, onHome }) {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("habits");
  const [saved, setSaved] = useState("");

  const load = () => api("state").then(setState).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!state) return <div className="nbk-loading">Opening your notebook…</div>;

  const book = state.notebook;
  const prog = state.progress || [];
  const flash = (msg = "Saved.") => { setSaved(msg); setTimeout(() => setSaved(""), 1800); };

  // The server owns progress and streaks, so the page never computes a number he
  // would disagree with. Every mutation hands back a fresh view.
  const apply = (data) => setState((s) => ({ ...s, ...data }));

  const counts = {
    routines: (book?.routines?.length || 0) + (book?.automations?.length || 0),
    habits: prog.length + (book?.slipping?.length || 0),
    focus: (book?.focus?.deepWork?.length || 0) + (book?.focus?.distractions?.length || 0)
      + ((book?.focus?.music?.mood || book?.focus?.music?.playlist) ? 1 : 0),
  };

  return (
    <div className="nbk">
      <header className="nbk-head">
        <div>
          <span className="nbk-mark"><Greeno size={26} /> Greeno</span>
          <h1 className="display nbk-h1">{emphasise("Your *notebook*")}</h1>
          <p className="nbk-sub">
            {book ? "What Greeno knows about you. He wrote this from what you told him."
                  : "Nothing here yet. Do the yap and he will fill this in."}
          </p>
        </div>
        <div className="nbk-head-actions">
          {book && <span className="nbk-when">day starts {book.startTime}</span>}
          <button className="btn btn-quiet" onClick={onHome}>Home</button>
          <button className="btn" onClick={onRedo}>Do the yap again</button>
        </div>
      </header>

      {book && <Greeting onDebriefed={load} />}

      <nav className="nbk-tabs">
        {TABS.map(([id]) => (
          <button key={id} className={`nbk-tab${tab === id ? " is-on" : ""}`} onClick={() => setTab(id)}>
            {id[0].toUpperCase() + id.slice(1)}
            {counts[id] ? <span className="nbk-tab-n">{counts[id]}</span> : null}
          </button>
        ))}
      </nav>

      <div className="nbk-body">
        <div className="nbk-note">
          {TABS.find(([id]) => id === tab)[1]}
          {saved && <span className="nbk-saved"> · {saved}</span>}
        </div>

        {tab === "routines" && (
          <Rows empty="Nothing here yet.">
            {(book?.routines || []).map((r) => <Row key={r.id} title={r.label} meta={`${days(r.days)} · ${r.start}-${r.end}`} />)}
            {(book?.automations || []).map((a) => <Row key={a.id} title={a.title} why={a.detail} meta={a.status === "wished" ? "wished for" : a.trigger} />)}
          </Rows>
        )}

        {tab === "habits" && (
          <Habits
            habits={prog}
            slipping={book?.slipping || []}
            dueToday={state.dueToday || []}
            onChange={apply}
            flash={flash}
          />
        )}

        {tab === "focus" && (
          <Rows empty="Nothing here yet.">
            {(book?.focus?.deepWork || []).map((w, i) => <Row key={`d${i}`} title="Deep work" meta={`${days(w.days)} · ${w.start}-${w.end}`} />)}
            {(book?.focus?.distractions || []).map((d, i) => <Row key={`x${i}`} title={d} meta="pulls you out" />)}
            {(book?.focus?.music?.mood || book?.focus?.music?.playlist) && (
              <Row title={book.focus.music.playlist || book.focus.music.mood}
                   why={book.focus.music.playlist && book.focus.music.mood ? book.focus.music.mood : ""}
                   meta={book.focus.music.service !== "none" ? book.focus.music.service : "music"} />
            )}
          </Rows>
        )}

        {tab === "setup" && <Setup state={state} reload={load} flash={flash} />}
      </div>
    </div>
  );
}

// ── he speaks first ────────────────────────────────────────────────────────
// The whole accountability question, answered without a single new AI call:
// you open the page and he is already talking about today. morningGreet() and
// debrief() both exist and already handle varying the wording, the ghosted
// moment, and writing check-ins.
function Greeting({ onDebriefed }) {
  const [said, setSaid] = useState("");
  const [due, setDue] = useState([]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState("");
  const [reaction, setReaction] = useState("");
  const rec = React.useRef(null);
  const mime = React.useRef("");

  useEffect(() => {
    let live = true;
    api("greet", {}).then((g) => {
      if (!live) return;
      setSaid(g.said || "");
      setDue(g.due || []);
      speak(g.said);
    }).catch((err) => {
      // Say so rather than rendering nothing. A silent catch here is what hid a
      // GET being sent to a POST-only route.
      if (live) setSaid(`I could not put your morning together. ${err.message}`);
    });
    return () => { live = false; stopSpeech(); };
  }, []);

  if (!said) return null;

  async function toggle() {
    if (asking) {
      setAsking(false);
      setBusy("Writing that down");
      try {
        const transcript = await rec.current.stopAndTranscribe(mime.current);
        if (transcript) {
          const out = await api("debrief", { transcript });
          setReaction(out.reaction);
          speak(out.reaction);
          await onDebriefed();
        }
      } catch (err) { setReaction(String(err.message)); }
      setBusy("");
      return;
    }
    stopSpeech();
    rec.current = createRecorder();
    try { mime.current = await rec.current.start(); setAsking(true); }
    catch (err) { setReaction(`I cannot reach the microphone. ${err.message}`); }
  }

  return (
    <section className="greet">
      <span className="greet-mark"><Greeno size={34} /></span>
      <div className="greet-body">
        <p className="greet-said">{reaction || said}</p>
        {!reaction && due.length > 0 && (
          <p className="greet-due">Due today: {due.map((d) => d.title).join(", ")}.</p>
        )}
      </div>
      <button className={`btn${asking ? " btn-primary" : ""}`} onClick={toggle} disabled={Boolean(busy)}>
        {busy ? `${busy}…` : asking ? "Done, that is it" : "Tell him how it went"}
      </button>
    </section>
  );
}

// ── habits ─────────────────────────────────────────────────────────────────
function Habits({ habits, slipping, dueToday, onChange, flash }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null);

  async function tick(h, value) {
    onChange(await api("checkin", { habitId: h.id, value }));
    flash(value >= h.target ? "Logged." : value === 0 ? "Cleared." : "Counted.");
  }

  async function add() {
    const title = draft.trim();
    if (!title) return setAdding(false);
    onChange(await api("habit/add", { title }));
    setDraft(""); setAdding(false); flash("Added.");
  }

  return (
    <>
      <div className="rows">
        {habits.length === 0 && !adding && <div className="empty">No habits yet.</div>}

        {habits.map((h) => (
          <div key={h.id} className={`row habit${h.done >= h.target ? " is-hit" : ""}`}>
            <div className="habit-main">
              {editing === h.id ? (
                <HabitEditor h={h} onChange={onChange} flash={flash} close={() => setEditing(null)} />
              ) : (
                <>
                  <div className="habit-title">
                    <button className="habit-name" onClick={() => setEditing(h.id)} title="Rename">
                      {h.title}
                    </button>
                    {h.streak > 1 && <span className="habit-streak">{h.streak} day streak</span>}
                    {dueToday.includes(h.id) && h.todayValue === 0 && <span className="habit-due">due today</span>}
                  </div>
                  {(h.todayNote || h.why) && <div className="row-why">{h.todayNote || h.why}</div>}
                  <div className="bar"><i className="bar-fill" style={{ width: `${h.pct}%` }} /></div>
                </>
              )}
            </div>

            <div className="habit-side">
              <span className="row-meta">{h.done} / {h.target} {h.unit}</span>
              {/* A one-a-day habit is a yes or no. Anything counted needs a stepper,
                  because "did you read" and "how many pages" are different questions. */}
              {h.target <= 1 ? (
                <button
                  className={`tick${h.todayValue >= h.target ? " is-on" : ""}`}
                  onClick={() => tick(h, h.todayValue >= h.target ? 0 : h.target)}
                  aria-label={h.todayValue >= h.target ? "Undo today" : "Mark done today"}
                >✓</button>
              ) : (
                <span className="stepper">
                  <button onClick={() => tick(h, Math.max(0, h.todayValue - 1))} aria-label="One less">−</button>
                  <b>{h.todayValue}</b>
                  <button onClick={() => tick(h, h.todayValue + 1)} aria-label="One more">+</button>
                </span>
              )}
            </div>
          </div>
        ))}

        {slipping.map((s, i) => <Row key={`s${i}`} title={s} meta="keeps slipping" />)}
      </div>

      {adding ? (
        <div className="habit-add">
          <input autoFocus value={draft} placeholder="Read 20 pages"
                 onChange={(e) => setDraft(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(false); }} />
          <button className="btn btn-primary" onClick={add}>Add</button>
          <button className="btn btn-quiet" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn habit-add-btn" onClick={() => setAdding(true)}>Add a habit</button>
      )}
    </>
  );
}

function HabitEditor({ h, onChange, flash, close }) {
  const [title, setTitle] = useState(h.title);
  const [target, setTarget] = useState(h.target);
  const [unit, setUnit] = useState(h.unit);
  const [cadence, setCadence] = useState(h.cadence);

  async function save() {
    onChange(await api("habit/update", { id: h.id, title, target, unit, cadence }));
    flash("Saved."); close();
  }
  async function remove() {
    if (!window.confirm(`Delete "${h.title}"? Its check-ins go too.`)) return;
    onChange(await api("habit/delete", { id: h.id }));
    flash("Deleted."); close();
  }

  return (
    <div className="habit-edit">
      <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)}
             onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") close(); }} />
      <div className="habit-edit-row">
        <input type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pages" />
        <select value={cadence} onChange={(e) => setCadence(e.target.value)}>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
        </select>
        <button className="btn btn-primary" onClick={save}>Save</button>
        <button className="btn btn-quiet" onClick={close}>Cancel</button>
        <button className="btn btn-quiet habit-delete" onClick={remove}>Delete</button>
      </div>
    </div>
  );
}

// ── setup ──────────────────────────────────────────────────────────────────
function Setup({ state, reload, flash }) {
  const book = state.notebook;
  return (
    <div className="setup-grid">
      <label className="setup-row">
        <span className="setup-label">My day starts at</span>
        <input className="setup-input" type="time" step="300" defaultValue={book?.startTime || "08:30"}
               onChange={async (e) => {
                 if (!book || !/^\d{2}:\d{2}$/.test(e.target.value)) return;
                 await api("notebook", { notebook: { ...book, startTime: e.target.value } });
                 await reload(); flash();
               }} />
        <span className="setup-hint">He greets you inside the 45 minutes after this.</span>
      </label>

      <label className="setup-row">
        <span className="setup-label">Ask me how it went at</span>
        <input className="setup-input" type="time" step="300" defaultValue={state.settings?.nightTime || "21:00"}
               onChange={async (e) => {
                 if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
                 await api("settings", { patch: { nightTime: e.target.value } }); flash();
               }} />
        <span className="setup-hint">The night debrief, once a day from this time.</span>
      </label>

      <div className="setup-row">
        <span className="setup-label">Your data</span>
        <a className="btn" href="/api/export" download>Export everything</a>
        <span className="setup-hint">Every habit, check-in and note, as one JSON file.</span>
      </div>

      {/* Said out loud rather than half-built. A "coming next" list is honest;
          a broken invite flow is not. */}
      <div className="setup-next">
        <span className="badge">Coming next</span>
        <ul>
          <li><b>Push notifications</b> — real reminders with the browser closed.</li>
          <li><b>Social accountability</b> — invite a friend, see each other's streaks. Needs accounts.</li>
          <li><b>Weekly insights</b> — what your patterns actually look like.</li>
          <li><b>Cross-device sync</b> — the same notebook everywhere.</li>
        </ul>
      </div>
    </div>
  );
}

const days = (d = []) => d.map((x) => x[0].toUpperCase() + x.slice(1)).join(" ");

function Rows({ children, empty }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return <div className="rows">{kids.length ? kids : <div className="empty">{empty}</div>}</div>;
}

function Row({ title, why, meta }) {
  return (
    <div className="row">
      <div>
        <div className="row-title">{title}</div>
        {why && <div className="row-why">{why}</div>}
      </div>
      <div className="row-meta">{meta}</div>
    </div>
  );
}
