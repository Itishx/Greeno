import React, { useEffect, useState } from "react";
import { api } from "./lib.jsx";
import Landing from "./Landing.jsx";
import Onboarding from "./Onboarding.jsx";
import Notebook from "./Notebook.jsx";

export default function App() {
  const [view, setView] = useState("landing");   // landing | onboarding | notebook
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

  if (view === "onboarding") {
    return (
      <Onboarding
        state={state}
        onQuit={() => setView("landing")}
        onDone={async () => { await refresh(); setView("notebook"); }}
      />
    );
  }
  if (view === "notebook") {
    return <Notebook onHome={() => setView("landing")} onRedo={() => setView("onboarding")} />;
  }
  return (
    <Landing
      hasNotebook={Boolean(state.notebook && state.approved)}
      onStart={() => setView("onboarding")}
      onOpenNotebook={() => setView("notebook")}
    />
  );
}
