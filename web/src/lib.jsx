import React from "react";
// Everything the pages need that is not a component.

// ── talking to the server ──────────────────────────────────────────────────
//
// The server may or may not have a place to keep your notebook. Locally it has a
// JSON file; on Vercel it has nothing durable at all. So this browser is the
// durable copy, and the rule is simple and self-configuring:
//
//   send the document if we have one, and keep whatever comes back.
//
// Locally the server never returns a document, so we never save one and never
// send one, and the file on disk stays the single source of truth. Deployed, the
// server always returns one, so we keep it and hand it back next time. Neither
// side needs to be told which mode it is in.
const STORE_KEY = "greeno-store-v1";

function readStore() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeStore(doc) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(doc)); } catch { /* private window */ }
}

export function clearStore() {
  try { window.localStorage.removeItem(STORE_KEY); } catch {}
}

export function hasLocalStore() { return Boolean(readStore()); }

export async function api(path, body) {
  const doc = readStore();
  const payload = { ...(body || {}) };
  if (doc) payload.store = doc;

  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!json.ok) throw new Error(json.error || "that did not go through");

  // Only present when the server had nowhere to persist. Keeping it is what
  // makes a notebook survive a refresh on a serverless host.
  if (json.store) writeStore(json.store);
  return json.data;
}

export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ── his voice ──────────────────────────────────────────────────────────────
// Split into sentences and play one at a time, prefetching the next while the
// current one plays. First audio then costs one short sentence rather than the
// whole reply. A generation token retires everything the moment he is stopped.
let generation = 0;
let current = null;

function sentences(text) {
  const rough = String(text).match(/[^.!?\n]+[.!?]*/g) || [text];
  const out = [];
  for (const piece of rough.map((s) => s.trim()).filter(Boolean)) {
    if (out.length && (out[out.length - 1].length < 24 || piece.length < 24)) {
      out[out.length - 1] = `${out[out.length - 1]} ${piece}`.trim();
    } else out.push(piece);
  }
  return out.length ? out : [text];
}

export function stopSpeech() {
  generation += 1;
  if (current) { try { current.pause(); } catch {} current.src = ""; current = null; }
}

export async function speak(text) {
  if (!text) return;
  stopSpeech();
  const token = ++generation;
  const parts = sentences(text);
  let pending = null;
  const fetchOne = (s) => fetch(`/api/tts?text=${encodeURIComponent(s)}`).then((r) => (r.ok ? r.blob() : null));

  for (let i = 0; i < parts.length; i++) {
    if (token !== generation) return;
    const blob = await (pending || fetchOne(parts[i]));
    pending = i + 1 < parts.length ? fetchOne(parts[i + 1]) : null;
    if (token !== generation || !blob) return;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    try { await audio.play(); } catch { URL.revokeObjectURL(url); return; }
    await new Promise((r) => {
      audio.addEventListener("ended", r, { once: true });
      audio.addEventListener("error", r, { once: true });
    });
    URL.revokeObjectURL(url);
    if (token !== generation) return;
  }
  current = null;
}

// ── him listening ──────────────────────────────────────────────────────────
export function createRecorder() {
  let rec = null, chunks = [], stream = null, ctx = null, raf = 0;

  async function start(onLevel) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start(250);

    if (onLevel) {
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
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
    return mime;
  }

  async function stopAndTranscribe(mime) {
    if (!rec) return "";
    const done = new Promise((r) => rec.addEventListener("stop", r, { once: true }));
    rec.stop();
    await done;
    cancelAnimationFrame(raf);
    ctx?.close().catch(() => {});
    stream?.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: mime });
    rec = null; stream = null; ctx = null;

    const b64 = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result).split(",")[1]);
      fr.readAsDataURL(blob);
    });
    const { text } = await api("transcribe", { audio: b64, mimeType: blob.type });
    return text;
  }

  return { start, stopAndTranscribe };
}

// *phrase* becomes italic. Built as nodes, never innerHTML: the only safe thing
// to do with somebody's own words is not parse them.
export function emphasise(marked) {
  return String(marked || "").split(/(\*[^*]+\*)/).filter(Boolean).map((part, i) =>
    part.startsWith("*") && part.endsWith("*") && part.length > 2
      ? <em key={i} className="em">{part.slice(1, -1)}</em>
      : <span key={i}>{part}</span>);
}
