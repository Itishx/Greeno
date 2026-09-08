// The notebook. Three sections, and the habit bars fill live while he is still
// reacting during the debrief.
(() => {
  const $ = (id) => document.getElementById(id);
  let book = null;
  let prog = [];

  const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const days = (d = []) => d.map((x) => DAY_LABEL[x] || x).join(" ");

  function row({ title, why, meta, bar, hit, fresh }) {
    const el = document.createElement("div");
    el.className = `row${hit ? " is-hit" : ""}${fresh ? " is-fresh" : ""}`;
    const main = document.createElement("div");
    const t = document.createElement("div");
    t.className = "row-title";
    t.textContent = title;
    main.appendChild(t);
    if (why) {
      const w = document.createElement("div");
      w.className = "row-why";
      w.textContent = why;
      main.appendChild(w);
    }
    if (bar) {
      const wrap = document.createElement("div");
      wrap.className = "bar";
      const fill = document.createElement("i");
      fill.className = "bar-fill";
      wrap.appendChild(fill);
      main.appendChild(wrap);
      // The width is set in fillBars() once this row is actually in the document.
      // Setting it here would animate from nothing, because an element outside
      // the DOM has no computed start value to transition from.
      fill.dataset.pct = String(bar);
    }
    el.appendChild(main);
    const m = document.createElement("div");
    m.className = "row-meta";
    m.textContent = meta;
    el.appendChild(m);
    return el;
  }

  function empty(text) {
    const el = document.createElement("div");
    el.className = "empty";
    el.textContent = text;
    return el;
  }

  // Called once every row is in the document. The reflow gives the transition a
  // real starting value, so the bars visibly fill rather than appearing full.
  function fillBars(host) {
    const fills = host.querySelectorAll(".bar-fill[data-pct]");
    if (!fills.length) return;
    void host.offsetWidth;
    fills.forEach((f) => { f.style.width = `${f.dataset.pct}%`; });
  }

  function render(freshIds = new Set()) {
    const R = $("rows-routines"), H = $("rows-habits"), F = $("rows-focus");
    R.replaceChildren(); H.replaceChildren(); F.replaceChildren();

    // Routines, and the automations they wish they had.
    const routines = book?.routines || [];
    const autos = book?.automations || [];
    if (!routines.length && !autos.length) R.appendChild(empty("Nothing here yet."));
    for (const r of routines) {
      R.appendChild(row({ title: r.label, meta: `${days(r.days)} · ${r.start}-${r.end}` }));
    }
    for (const a of autos) {
      R.appendChild(row({
        title: a.title,
        why: a.detail,
        // "wished" is a promise, not a backlog, and it is labelled honestly.
        meta: a.status === "wished" ? "wished for" : a.trigger,
      }));
    }

    // Habits, with the bars.
    if (!prog.length) H.appendChild(empty("No habits yet."));
    for (const h of prog) {
      H.appendChild(row({
        title: h.title,
        why: h.lastNote || h.why || "",
        meta: `${h.done} / ${h.target} ${h.unit}`,
        bar: h.pct,
        hit: h.done >= h.target,
        fresh: freshIds.has(h.id),
      }));
    }
    for (const s of book?.slipping || []) {
      H.appendChild(row({ title: s, meta: "keeps slipping" }));
    }

    // Focus.
    const dw = book?.focus?.deepWork || [];
    const dx = book?.focus?.distractions || [];
    const music = book?.focus?.music;
    if (!dw.length && !dx.length && !(music?.mood || music?.playlist)) F.appendChild(empty("Nothing here yet."));
    for (const w of dw) F.appendChild(row({ title: "Deep work", meta: `${days(w.days)} · ${w.start}-${w.end}` }));
    for (const d of dx) F.appendChild(row({ title: d, meta: "pulls you out" }));
    if (music?.mood || music?.playlist) {
      F.appendChild(row({
        title: music.playlist || music.mood,
        why: music.playlist && music.mood ? music.mood : "",
        meta: music.service && music.service !== "none" ? music.service : "music",
      }));
    }

    fillBars(H);

    // Each tab carries what he extracted for it, so the count IS the evidence
    // that he heard you.
    const n = (id, v) => { const el = $(id); if (el) el.textContent = v ? String(v) : ""; };
    n("n-routines", (book?.routines?.length || 0) + (book?.automations?.length || 0));
    n("n-habits", (prog?.length || 0) + (book?.slipping?.length || 0));
    n("n-focus", (book?.focus?.deepWork?.length || 0) + (book?.focus?.distractions?.length || 0)
                 + ((book?.focus?.music?.mood || book?.focus?.music?.playlist) ? 1 : 0));

    $("when").textContent = book ? `day starts ${book.startTime}` : "";
  }

  async function load(freshIds) {
    const s = await window.greeno.state();
    book = s.notebook;
    prog = s.progress || [];
    if (!book) {
      $("sub").textContent = "Nothing here yet. Do the yap and he will fill this in.";
    } else {
      $("sub").textContent = "What Greeno knows about you. He wrote this from what you told him.";
    }
    // The three editable settings.
    $("startTime").value = book?.startTime || "08:30";
    $("nightTime").value = s.settings?.nightTime || "21:00";
    $("screenWatch").checked = Boolean(s.screenWatch);

    render(freshIds);
  }

  // The debrief pushes its deltas here so the bars fill WHILE he is still
  // talking. The socket is wired before the persistence for exactly this reason.
  window.greeno.onFromNotch(async (msg) => {
    if (msg?.type !== "debrief") return;
    showTab("habits");
    await load(new Set((msg.updates || []).map((u) => u.habitId)));
  });

  // ── setup ────────────────────────────────────────────────────────────────
  let savedTimer = null;
  function flashSaved() {
    const el = $("saved");
    el.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.hidden = true; }, 1600);
  }

  async function saveStartTime(value) {
    if (!book || !/^\d{2}:\d{2}$/.test(value)) return;
    book.startTime = value;
    await window.greeno.saveNotebook({ notebook: book });
    $("when").textContent = `day starts ${value}`;
    flashSaved();
  }

  $("startTime").addEventListener("change", (e) => saveStartTime(e.target.value));
  $("nightTime").addEventListener("change", async (e) => {
    if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
    await window.greeno.settings({ patch: { nightTime: e.target.value } });
    flashSaved();
  });
  $("screenWatch").addEventListener("change", async (e) => {
    await window.greeno.screenWatch({ on: e.target.checked });
    flashSaved();
  });

  // ── tabs ─────────────────────────────────────────────────────────────────
  let tab = "routines";
  function showTab(next) {
    tab = next;
    document.querySelectorAll(".nbk-tab").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === next));
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== next; });
  }
  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".nbk-tab");
    if (btn) showTab(btn.dataset.tab);
  });

  $("close").addEventListener("click", () => window.greeno.closeBook());
  $("redo").addEventListener("click", () => window.greeno.openBook({ route: "onboarding" }));

  load();
})();
