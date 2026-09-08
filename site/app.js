/* The site's only script. Three jobs: reveal on scroll, run the notch through
   its real states, and hand the email form to a mail client.

   The notch geometry and the timings are the app's, not made up here. The pill
   springs on 0.55s cubic-bezier(.32,.72,0,1) and content crossfades on the
   answer timings, which is why it reads as the same object resizing rather
   than five different boxes. */

(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── reveal ────────────────────────────────────────────────────────────── */
  var targets = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(function (el, i) {
      // A short stagger inside one group, so a row of cards arrives in order.
      el.style.transitionDelay = (i % 3) * 70 + 'ms';
      io.observe(el);
    });
  }

  /* ── the nav hairline, only once the page has moved ────────────────────── */
  var nav = document.getElementById('nav');
  var onScroll = function () { nav.classList.toggle('stuck', window.scrollY > 8); };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ── the notch ─────────────────────────────────────────────────────────── */
  var nf = document.getElementById('nf');
  if (nf) {
    var panes = {};
    nf.querySelectorAll('.nf-pane').forEach(function (p) { panes[p.dataset.pane] = p; });
    var lines = Array.prototype.slice.call(document.querySelectorAll('#greetLines p'));

    // state, how long it holds. This is the demo loop, in the demo's order.
    var script = [
      ['idle', 2600],
      ['listening', 3200],
      ['working', 1500],
      ['greeting', 7200],
      ['idle', 1800],
      ['short', 5200]
    ];

    var i = 0, timer = null, karaoke = [], visible = true;

    function clearKaraoke() {
      karaoke.forEach(clearTimeout);
      karaoke = [];
      lines.forEach(function (l) { l.classList.remove('said'); });
    }

    function show(state) {
      Object.keys(panes).forEach(function (k) { panes[k].classList.toggle('on', k === state); });
      nf.dataset.state = state;
      clearKaraoke();
      // The greet reads one line at a time, the way he actually says it.
      if (state === 'greeting') {
        lines.forEach(function (l, n) {
          karaoke.push(setTimeout(function () { l.classList.add('said'); }, 700 + n * 1500));
        });
      }
    }

    function step() {
      var frame = script[i % script.length];
      show(frame[0]);
      i++;
      timer = setTimeout(step, frame[1]);
    }

    function stop() { clearTimeout(timer); clearKaraoke(); timer = null; }

    if (reduced) {
      // No loop. Park him on the greet, which is the frame worth seeing.
      show('greeting');
      lines.forEach(function (l) { l.classList.add('said'); });
    } else {
      // Only run while the stage is actually on screen.
      var stage = document.getElementById('stage');
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          if (visible && !timer) step();
          else if (!visible && timer) stop();
        }, { threshold: 0.15 }).observe(stage);
      } else {
        step();
      }
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop();
        else if (visible && !timer) step();
      });
    }
  }

  /* ── the form ──────────────────────────────────────────────────────────── */
  /* No backend, and no fake "you are on the list" either. It opens a mail
     client with the address already written, which is honest and works from a
     static host. Point INBOX at wherever you want these to land. */
  var INBOX = 'hello@greeno.app';
  var form = document.getElementById('signup');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('input[name="email"]').value.trim();
      if (!email) return;
      window.location.href = 'mailto:' + INBOX
        + '?subject=' + encodeURIComponent('Early access, please')
        + '&body=' + encodeURIComponent('Put me on the list.\n\n' + email + '\n');
    });
  }
})();
