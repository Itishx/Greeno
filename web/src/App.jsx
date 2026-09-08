import React, { useEffect, useState } from "react";
import { api } from "./lib.jsx";
import Landing from "./Landing.jsx";
import Onboarding from "./Onboarding.jsx";
import Notebook from "./Notebook.jsx";

export default function App() {
  // site/ is the landing page now, and its "Get started" is what brings you
  // here. Showing a SECOND landing page with a SECOND Get started was a step
  // that existed only because this app used to own the front door.
  //
  // So /app goes straight to work: the notebook if there is one, otherwise the
  // first question. ?home=1 still reaches the in-app landing for anyone who
  // wants it.
  const wantsHome = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("home");
  const [view, setView] = useState(wantsHome ? "landing" : null);   // null until state says which
  const [state, setState] = useState(null);
  const [error, setError] = useState("");

  const refresh = () => api("state").then(setState).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  if (error) {
    return (
      <div className="boot-error">
        <h1 className="display">Cannot reach Greeno.</h1>
        <p>{error}</p>
        <p className="muted">Run <code>npm run web</code> so the API is up alongside the site.</p>
      </div>
    );
  }
  if (!state) return <div className="nbk-loading">One second…</div>;

  // First render after state arrives: pick where to land.
  if (view === null) {
    setView(state.notebook && state.approved ? "notebook" : "onboarding");
    return <div className="nbk-loading">One second…</div>;
  }

  if (view === "onboarding") {
    return (
      <Onboarding
        state={state}
        onQuit={() => setView(state.notebook ? "notebook" : "landing")}
        onDone={async () => { await refresh(); setView("notebook"); }}
      />
    );
  }
  if (view === "notebook") {
    return <Notebook onHome={() => { window.location.href = "/"; }} onRedo={() => setView("onboarding")} />;
  }
  return (
    <Landing
      hasNotebook={Boolean(state.notebook && state.approved)}
      onStart={() => setView("onboarding")}
      onOpenNotebook={() => setView("notebook")}
    />
  );
}
