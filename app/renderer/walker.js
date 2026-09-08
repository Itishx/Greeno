// The mascot. He walks, he walks OVER to things, he reacts, and he plants
// himself when you talk to him.
//
// The constants in the gait are not tuned by feel any more. Do not adjust them
// without watching the result at 60fps.
(function () {
  // px/s at scale 1, and it scales WITH him. A bigger Greeno covering the same
  // pixels per second reads as slow motion, so the glide has to grow too.
  const BASE_SPEED = 80;
  const W = 64, H = 78;
  const LAUNCH_MS = 900;

  // He can be made bigger. 1 to 5, remembered between launches.
  const SCALE_KEY = "greeno-mascot-scale-v1";
  const SCALE_MIN = 1, SCALE_MAX = 5;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function readScale() {
    try {
      const stored = Number.parseFloat(window.localStorage.getItem(SCALE_KEY) || "");
      return Number.isFinite(stored) ? clamp(stored, SCALE_MIN, SCALE_MAX) : SCALE_MIN;
    } catch { return SCALE_MIN; }
  }

  function mount(hostEl, opts = {}) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const walker = document.createElement("div");
    walker.className = "braino-walker";
    const flip = document.createElement("div");
    flip.className = "braino-walker-flip";
    // A wrapper div, not an SVG group: flipping the whole element is one
    // transform instead of a group transform that fights the root's rotate.
    flip.innerHTML = window.GREENO_WALKER_SVG;
    walker.appendChild(flip);
    hostEl.appendChild(walker);

    const q = (sel) => walker.querySelector(sel);
    const root = q("#__sbwk_root__");
    const smile = q("#__sbwk_smile__");
    const talk = q("#__sbwk_talk__");
    const react = q("#__sbwk_react__");
    const rHyped = q("#__sbwk_rc__");
    const rSad = q("#__sbwk_rs__");
    const rTear = q("#__sbwk_rt__");

    const bounds = () => ({ w: hostEl.clientWidth || innerWidth, h: hostEl.clientHeight || innerHeight });
    const clampX = (x) => Math.max(4, Math.min(bounds().w - scaledW() - 4, x));
    const clampY = (y) => Math.max(4, Math.min(bounds().h - scaledH() - 4, y));

    const state = {
      curX: opts.x ?? 80, curY: opts.y ?? 120,
      targetX: opts.x ?? 80, targetY: opts.y ?? 120,
      facing: 1, sitting: false, perchEl: null,
      mouseX: -9999, mouseY: -9999,
      voiceActive: false, speaking: false, thinking: false,
      talking: false, mood: "idle",
      nextWander: 0, launching: false, fromX: 0, fromY: 0, toX: 0, toY: 0, t0: 0,
      raf: 0, lastTs: performance.now(), start: performance.now(),
      scale: readScale(), dragging: false, pointerId: null, grabX: 0, grabY: 0,
      hovering: false, roam: opts.roam !== false,
      mouthWritten: null, visible: false, lastTransform: "", lastFlip: "",
    };

    // His footprint grows with him, so the bounds and the cursor test both have
    // to use the scaled size rather than the 64x78 art box.
    const scaledW = () => W * state.scale;
    const scaledH = () => H * state.scale;

    // ── the walk cycle ──────────────────────────────────────────────────────
    function applyPose(now, moving) {
      const t = (now - state.start) / 1000;

      // One phase drives everything. 4.5 is the stride rate; legs are pi apart.
      const s = t * 4.5;
      const Lp = Math.sin(s), Rp = Math.sin(s + Math.PI);

      // Legs LIFT (translate) and SWING (rotate) on the same phase. Only the
      // positive half of the sine is used, so a leg lifts and comes back down
      // rather than sinking through the floor on the negative half.
      const ll = moving ? Math.max(0, Lp) * 5 : 0;
      const rl = moving ? Math.max(0, Rp) * 5 : 0;
      const ls = moving ? Math.max(0, Lp) * 8 : 0;
      const rs = moving ? Math.max(0, Rp) * 8 : 0;

      // The three body motions. Waddle does the work: without the rotation he
      // reads as a sprite sliding along, legs or no legs.
      const waddle = moving ? Math.sin(s) * 3.4 : 0;
      const walkBob = moving ? -Math.abs(Math.sin(s)) * 2 - 0.4 : 0;
      // breath and bob run whether or not he is walking. Standing perfectly
      // still is what makes a character read as an asset.
      const breath = 1 + 0.014 * Math.sin(t * 1.7);
      const bob = Math.sin(t * 1.7 + 0.6) * 0.8;

      // Blink every 3.4s, 130ms, shaped as half a sine so the lid accelerates.
      const bp = t % 3.4;
      const blink = bp < 0.13 ? Math.sin((bp / 0.13) * Math.PI) : 0;
      const eyeSy = Math.max(0.06, 1 - blink);   // never fully zero

      root?.setAttribute("transform",
        `rotate(${waddle} 50 50) translate(0 ${bob + walkBob}) scale(${breath})`);
      q("#__sbwk_ll__")?.setAttribute("transform", `translate(0 ${-ll}) rotate(${ls} 44 74)`);
      q("#__sbwk_rl__")?.setAttribute("transform", `translate(0 ${-rl}) rotate(${rs} 56 74)`);
      // Scale about the eye's own centre, or the blink slides the eye up the face.
      q("#__sbwk_eye_l__")?.setAttribute("transform", `translate(38,48) scale(1,${eyeSy}) translate(-38,-48)`);
      q("#__sbwk_eye_r__")?.setAttribute("transform", `translate(62,48) scale(1,${eyeSy}) translate(-62,-48)`);

      // The mouth follows the voice, never the text. Written only when it
      // changes: this used to be two style writes every frame, sixty times a
      // second, almost always setting the value it already had.
      if (smile && talk && state.talking !== state.mouthWritten) {
        state.mouthWritten = state.talking;
        smile.style.display = state.talking ? "none" : "";
        talk.style.display = state.talking ? "" : "none";
      }
      if (state.talking) {
        const open = 1 + 0.55 * Math.abs(Math.sin(t / 0.28 * Math.PI));
        q("#__sbwk_te__")?.setAttribute("ry", String(1.4 * open));
      }
    }

    function writeTransform() {
      const t = `translate(${state.curX.toFixed(1)}px, ${state.curY.toFixed(1)}px)`;
      if (t !== state.lastTransform) { state.lastTransform = t; walker.style.transform = t; }
      const f = `scaleX(${state.facing}) scale(${state.scale})`;
      if (f !== state.lastFlip) { state.lastFlip = f; flip.style.transform = f; }
    }

    // ── the main tick ───────────────────────────────────────────────────────
    function tick(now) {
      // While he is inside the notch there is nothing of him to animate, and the
      // boot needs the main thread more than a hidden mascot does. Sixteen DOM
      // writes a frame against a pill animating its own width is exactly the
      // kind of contention you see as jank.
      if (!state.visible) {
        state.lastTs = now;
        state.raf = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, (now - state.lastTs) / 1000);
      state.lastTs = now;

      if (state.launching) {
        launchFrame(now);
        walker.style.transform = `translate(${state.curX}px, ${state.curY}px)`;
        flip.style.transform = `scaleX(${state.facing})`;
        applyPose(now, true);
        state.raf = requestAnimationFrame(tick);
        return;
      }

      // If he is heading for a real element, re-measure it every frame. Pages
      // reflow, and a target captured once leaves him walking to where a card
      // used to be.
      if (state.perchEl?.isConnected) {
        const r = state.perchEl.getBoundingClientRect();
        const b = bounds();
        if (r.width >= 60 && r.top > 40 && r.top < b.h - 60) {
          // Stand toward one END of the thing, not dead centre. Off-centre reads
          // as deliberate; centred reads as a watermark.
          const frac = (r.left + r.width / 2) < b.w / 2 ? 0.78 : 0.22;
          state.targetX = clampX(r.left + r.width * frac - W / 2);
          state.targetY = clampY(r.top - (H - 6));
        } else {
          state.perchEl = null;
        }
      }

      // Held, so he stays exactly where the hand is. No roaming, no stepping
      // aside, no pose changes fighting the drag.
      if (state.dragging) {
        writeTransform();
        applyPose(now, false);
        state.raf = requestAnimationFrame(tick);
        return;
      }

      // Get out of the user's way. He never becomes something you have to move
      // the mouse around.
      const feetX = state.curX + scaledW() / 2, feetY = state.curY + scaledH();
      if (Math.hypot(feetX - state.mouseX, feetY - state.mouseY) < 120) {
        state.targetX = clampX(state.targetX + (state.curX < state.mouseX ? -140 : 140));
      }

      // FEET PLANTED FOR THE WHOLE CONVERSATION, not just while sound is
      // playing. Gating on TTS alone made him resume strolling in every gap:
      // while listening, while thinking, between two sentences of one answer.
      // Those gaps are exactly when you are looking at him.
      const inConversation = state.voiceActive || state.speaking || state.thinking;
      if (inConversation) {
        state.targetX = state.curX; state.targetY = state.curY;
        state.nextWander = now + 1500;   // or he darts off the instant you stop talking
      }

      const dx = state.targetX - state.curX, dy = state.targetY - state.curY;
      const dist = Math.hypot(dx, dy);
      const moving = !inConversation && dist > 3 && !reduced;

      if (moving) {
        if (Math.abs(dx) > 2) state.facing = dx > 0 ? 1 : -1;
        const stepPx = Math.min(dist, BASE_SPEED * state.scale * dt);  // min() so he never overshoots
        state.curX = clampX(state.curX + (dx / dist) * stepPx);
        state.curY = clampY(state.curY + (dy / dist) * stepPx);
        state.sitting = false;
      } else if (state.perchEl) {
        state.sitting = true;
      }

      writeTransform();
      applyPose(now, moving);

      // Arrive, breathe, then pick somewhere else.
      if (!moving && !inConversation && now > state.nextWander && state.roam) {
        wander(now);
      }

      state.raf = requestAnimationFrame(tick);
    }

    // Free roam is the default. Perching was the original design and it was
    // wrong most of the time: he would park on a card for a minute at a stretch,
    // which read as "he got stuck somewhere" rather than "he is out here with me".
    function wander(now) {
      const b = bounds();
      state.targetX = clampX(40 + Math.random() * (b.w - scaledW() - 80));
      state.targetY = clampY(b.h * 0.35 + Math.random() * (b.h * 0.45));
      // He arrives, stands a while, then picks somewhere else. Long pauses are
      // what make him read as living there rather than patrolling.
      state.nextWander = now + 2600 + Math.random() * 4400;
      state.perchEl = null;
    }

    // ── leaving the notch ───────────────────────────────────────────────────
    // He does not appear. He climbs out.
    function launch(fromX, fromY) {
      state.launching = true;
      state.fromX = fromX; state.fromY = fromY;
      state.curX = fromX; state.curY = fromY;
      state.toX = clampX(fromX);
      state.toY = clampY(fromY + 150);      // a short drop from where he stepped out
      state.t0 = performance.now();
    }

    function launchFrame(now) {
      const pr = (now - state.t0) / LAUNCH_MS;
      if (pr >= 1) {
        state.curX = state.toX; state.curY = state.toY;
        state.launching = false;
        state.targetX = state.curX; state.targetY = state.curY;
        return;
      }
      state.curX = state.fromX + (state.toX - state.fromX) * pr;
      const flatY = state.fromY + (state.toY - state.fromY) * pr;
      // 18px of arc, no more. The first version used 95px, which lifted him
      // above his own start point mid-flight, which is off the top of the screen
      // when he launches from the notch. That read as flying away rather than
      // climbing out.
      state.curY = flatY - 18 * Math.sin(Math.PI * pr);
      state.facing = state.toX >= state.fromX ? 1 : -1;
    }

    // ── reactions ───────────────────────────────────────────────────────────
    function setMood(mood) {
      state.mood = mood;
      if (!react) return;
      const map = { hyped: rHyped, streak: rHyped, dramatic: rSad, ghosted: rSad, sad: rTear };
      const pick = map[mood] || null;
      react.setAttribute("display", pick ? "" : "none");
      [rHyped, rSad, rTear].forEach((g) => g?.setAttribute("display", g === pick ? "" : "none"));
    }

    // He is inside a click-through window, so the pointer only reaches him if
    // we stop ignoring the mouse while it is over him. forward:true keeps
    // mousemove arriving even while clicks pass through, which is what makes
    // this possible at all.
    function over(x, y) {
      return x >= state.curX && x <= state.curX + scaledW()
        && y >= state.curY && y <= state.curY + scaledH();
    }

    hostEl.addEventListener("mousemove", (e) => {
      state.mouseX = e.clientX;
      state.mouseY = e.clientY;
      if (state.dragging) return;
      const now = over(e.clientX, e.clientY);
      if (now !== state.hovering) {
        state.hovering = now;
        walker.classList.toggle("is-draggable", now);
        opts.onInteractive?.(now);
      }
    });

    walker.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      state.dragging = true;
      state.pointerId = e.pointerId;
      state.grabX = e.clientX - state.curX;
      state.grabY = e.clientY - state.curY;
      walker.classList.add("is-dragging");
      try { walker.setPointerCapture(e.pointerId); } catch {}
      opts.onGrab?.();
    });

    walker.addEventListener("pointermove", (e) => {
      if (!state.dragging || e.pointerId !== state.pointerId) return;
      e.preventDefault();
      state.curX = clampX(e.clientX - state.grabX);
      state.curY = clampY(e.clientY - state.grabY);
      state.targetX = state.curX;
      state.targetY = state.curY;
      state.nextWander = performance.now() + 2200;
    });

    function endDrag(e) {
      if (!state.dragging || (e && e.pointerId !== state.pointerId)) return;
      try { walker.releasePointerCapture(state.pointerId); } catch {}
      state.dragging = false;
      state.pointerId = null;
      walker.classList.remove("is-dragging");
      // A hand placed him there. Do not snap him to a computed spot; resume
      // roaming from where he was dropped, after a beat, so he never freezes.
      state.targetX = state.curX;
      state.targetY = state.curY;
      state.nextWander = performance.now() + 1200;
      opts.onDrop?.();
    }
    walker.addEventListener("pointerup", endDrag);
    walker.addEventListener("pointercancel", endDrag);

    // Double click makes him bigger, and wraps back round to small at the top.
    walker.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.dragging = false;
      walker.classList.remove("is-dragging");
      const next = state.scale >= SCALE_MAX ? SCALE_MIN : state.scale + 1;
      setScale(next);
      opts.onResize?.(next);
    });

    function setScale(next) {
      state.scale = clamp(Number(next) || SCALE_MIN, SCALE_MIN, SCALE_MAX);
      try { window.localStorage.setItem(SCALE_KEY, String(state.scale)); } catch {}
      // He may have just grown past the edge he was standing at.
      state.curX = clampX(state.curX);
      state.curY = clampY(state.curY);
      state.targetX = state.curX;
      state.targetY = state.curY;
      state.nextWander = performance.now() + 1800;
    }
    state.raf = requestAnimationFrame(tick);

    return {
      el: walker,
      set voiceActive(v) { state.voiceActive = v; },
      set speaking(v) { state.speaking = v; state.talking = v; },
      set thinking(v) { state.thinking = v; },
      set talking(v) { state.talking = v; },
      setMood,
      setScale,
      // The boot keeps him still and out of sight until it hands him the screen.
      show() { state.visible = true; state.lastTs = performance.now(); walker.classList.add("is-visible"); },
      hide() { state.visible = false; walker.classList.remove("is-visible"); },
      setRoam(on) { state.roam = Boolean(on); if (on) state.nextWander = performance.now() + 900; },
      get scale() { return state.scale; },
      get dragging() { return state.dragging; },
      launch,
      walkTo(x, y) { state.targetX = clampX(x); state.targetY = clampY(y); state.perchEl = null; },
      walkToEl(el) { state.perchEl = el; },
      place(x, y) { state.curX = state.targetX = clampX(x); state.curY = state.targetY = clampY(y); },
      destroy() { cancelAnimationFrame(state.raf); walker.remove(); },
    };
  }

  window.GreenoWalker = { mount };
})();
