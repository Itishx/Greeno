import React from "react";
import { emphasise } from "./lib.jsx";
import Greeno from "./Greeno.jsx";

// The whole pitch, and one button. Everything below the fold is there to answer
// "what is this" for someone who did not arrive convinced.
export default function Landing({ onStart, hasNotebook, onOpenNotebook }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-mark"><Greeno size={30} /> Greeno</span>
        {hasNotebook && (
          <button className="btn btn-quiet" onClick={onOpenNotebook}>Open my notebook</button>
        )}
      </header>

      <section className="landing-hero">
        <span className="badge">Not an app. A someone.</span>
        <h1 className="display landing-h1">
          {emphasise("Just talk. I build your *tracker* while you do.")}
        </h1>
        <p className="landing-sub">
          Tell me who you are, what you do, and what a normal day looks like.
          No forms, nothing to fill in. Your routines, habits and focus appear
          on the right while you speak.
        </p>
        <div className="landing-cta">
          <button className="btn btn-primary btn-lg" onClick={onStart}>
            {hasNotebook ? "Do it again" : "Get started"}
          </button>
          <span className="landing-cta-note">About four minutes. Speak or type.</span>
        </div>
      </section>

      <section className="landing-three">
        {[
          ["Routines", "The shape your day already has. Lectures, standup, the gym, the commute."],
          ["Habits", "The things you are trying to do a certain amount of. He holds you to these."],
          ["Focus", "When your head is clear, what pulls you out of it, and what you listen to."],
        ].map(([name, what]) => (
          <div className="landing-card" key={name}>
            <span className="badge">{name}</span>
            <p>{what}</p>
          </div>
        ))}
      </section>

      <section className="landing-how">
        <h2 className="display landing-h2">{emphasise("How it *works*")}</h2>
        <ol className="landing-steps">
          <li><b>You talk.</b> Five questions, one after another. Ramble, it is fine.</li>
          <li><b>He writes it down.</b> Your own words, into routines, habits and focus.</li>
          <li><b>You read it back.</b> If it is wrong anywhere you say so. Nothing saves until you approve it.</li>
          <li><b>He shows up.</b> Morning, when you look stuck, and at night to ask how it went.</li>
        </ol>
      </section>
    </div>
  );
}
