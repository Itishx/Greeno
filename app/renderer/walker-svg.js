// Greeno, drawn onto the Braino walker rig.
//
// The art is Greeno. The RIG is the ported one: same viewBox, same element ids,
// same hinge points. walker.js rotates #__sbwk_root__ about (50,50), swings the
// legs about (44,74) and (56,74), and blinks the eyes about (38,48) and (62,48),
// so every one of those landmarks is honoured below. Redraw the art freely,
// keep the ids and the hinges, and not a line of motion code has to change.
(function () {
  var G_LIGHT = "#8ecb6a";
  var G_MID = "#66b04a";
  var G_DARK = "#3f7a34";
  var G_LINE = "#356b2c";
  var BELT = "#6e4b36";
  var BELT_DARK = "#523829";
  var INK = "#1b2a16";

  // One arm, mirrored for the other side. Drawn as a capsule with a rounded hand.
  function arm(dir) {
    var sx = 50 + dir * 26;          // shoulder, just inside the body edge
    var ex = 50 + dir * 40;          // hand
    var cx = 50 + dir * 37;          // control point, so the arm bows outward
    return '<path d="M ' + sx + ' 57 Q ' + cx + ' 62 ' + ex + ' 71" fill="none" stroke="' + G_LINE + '" stroke-width="13" stroke-linecap="round"/>'
      + '<path d="M ' + sx + ' 57 Q ' + cx + ' 62 ' + ex + ' 71" fill="none" stroke="url(#gr-limb)" stroke-width="10.4" stroke-linecap="round"/>'
      + '<circle cx="' + ex + '" cy="72.5" r="8" fill="' + G_LINE + '"/>'
      + '<circle cx="' + ex + '" cy="72.5" r="6.6" fill="url(#gr-limb)"/>';
  }

  // One leg. The hinge sits at the top so the rotate in walker.js reads as a
  // swing from the hip rather than the whole leg pivoting in space.
  function leg() {
    return '<path d="M 0 82 L 0 99" fill="none" stroke="' + G_LINE + '" stroke-width="14" stroke-linecap="round"/>'
      + '<path d="M 0 82 L 0 99" fill="none" stroke="url(#gr-limb)" stroke-width="11.4" stroke-linecap="round"/>';
  }

  var HEAD = "M 50 16 C 62 16 70 23 70 37 C 70 51 63 59 50 59 C 37 59 30 51 30 37 C 30 23 38 16 50 16 Z";
  var BODY = "M 50 43 C 68 43 80 52 80 66 C 80 79 70 86 50 86 C 30 86 20 79 20 66 C 20 52 32 43 50 43 Z";

  var REACT = '<g id="__sbwk_react__" display="none">'
    // dramatic: flat brows, a sweat bead. For the day he has been ghosted.
    + '<g id="__sbwk_rs__" display="none">'
      + '<path d="M 31 40 L 44 40" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>'
      + '<path d="M 56 40 L 69 40" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>'
      + '<path id="__sbwk_sweat__" d="M 73 30 C 76 34 76 37 73 38 C 70 37 70 34 73 30 Z" fill="#CFEFFF" stroke="#7FB6D9" stroke-width="0.6"/>'
    + '</g>'
    // hyped: arched brows, open grin, confetti. The streak reaction.
    + '<g id="__sbwk_rc__" display="none">'
      + '<path d="M 32 38 Q 38 32 45 37" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>'
      + '<path d="M 68 38 Q 62 32 55 37" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>'
      + '<path d="M 40 52 Q 50 63 60 52 Q 50 55 40 52 Z" fill="' + INK + '"/>'
      + '<g id="__sbwk_confetti__">'
        + '<circle cx="14" cy="20" r="2.5" fill="#FFD700"/><circle cx="86" cy="18" r="2" fill="#FF69B4"/>'
        + '<circle cx="8" cy="42" r="2" fill="#7EC8E3"/><circle cx="92" cy="40" r="2.2" fill="#90EE90"/>'
        + '<circle cx="22" cy="8" r="1.8" fill="#FF8C42"/><circle cx="78" cy="8" r="1.8" fill="#E14A48"/>'
      + '</g>'
    + '</g>'
    // sad: down brows, tears.
    + '<g id="__sbwk_rt__" display="none">'
      + '<path d="M 32 36 Q 38 41 45 39" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>'
      + '<path d="M 68 36 Q 62 41 55 39" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>'
      + '<path id="__sbwk_tear_l__" d="M 34 52 C 37 56 37 58.5 34 59.5 C 31 58.5 31 56 34 52 Z" fill="#DFF4FF"/>'
      + '<path id="__sbwk_tear_r__" d="M 66 52 C 69 56 69 58.5 66 59.5 C 63 58.5 63 56 66 52 Z" fill="#DFF4FF"/>'
    + '</g>'
  + '</g>';

  var MOONLEGS = '<g id="__sbwk_moonlegs__" display="none">'
    + '<g id="__sbwk_mw_r__" transform="translate(56 0)"><g id="__sbwk_mw_rh__" transform="rotate(0 0 82)">' + leg() + '</g></g>'
    + '<g id="__sbwk_mw_l__" transform="translate(44 0)"><g id="__sbwk_mw_lh__" transform="rotate(0 0 82)">' + leg() + '</g></g>'
  + '</g>';

  var SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -34 116 142" width="64" height="78" overflow="visible" style="display:block">'
    + '<defs>'
      + '<linearGradient id="gr-body" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0" stop-color="' + G_LIGHT + '"/><stop offset="0.55" stop-color="' + G_MID + '"/><stop offset="1" stop-color="' + G_DARK + '"/>'
      + '</linearGradient>'
      + '<linearGradient id="gr-limb" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0" stop-color="' + G_MID + '"/><stop offset="1" stop-color="' + G_DARK + '"/>'
      + '</linearGradient>'
      + '<radialGradient id="gr-glow" cx="36%" cy="28%" r="52%">'
        + '<stop offset="0" stop-color="#e6ffd0" stop-opacity="0.55"/><stop offset="1" stop-color="#e6ffd0" stop-opacity="0"/>'
      + '</radialGradient>'
    + '</defs>'

    // The ground shadow lives OUTSIDE the root so the waddle does not rock it.
    + '<ellipse id="__sbwk_shadow__" cx="50" cy="103" rx="20" ry="4.2" fill="#000" opacity="0.14"/>'

    + '<g id="__sbwk_root__">'
      + MOONLEGS
      // Legs, hinged where walker.js rotates them: (44,74) and (56,74).
      + '<g id="__sbwk_ll__"><g transform="translate(41 0)">' + leg() + '</g></g>'
      + '<g id="__sbwk_rl__"><g transform="translate(59 0)">' + leg() + '</g></g>'
      // Back arm layers, so the arms read as behind the body.
      + '<g id="__sbwk_la_bg__">' + arm(-1) + '</g>'
      + '<g id="__sbwk_ra_bg__">' + arm(1) + '</g>'

      // Body, then belt, then head. One silhouette outline under each.
      + '<path d="' + BODY + '" fill="none" stroke="' + G_LINE + '" stroke-width="3.4"/>'
      + '<path d="' + BODY + '" fill="url(#gr-body)"/>'
      + '<path d="M 22.5 74 C 33 79 67 79 77.5 74 L 77.5 82 C 67 86.6 33 86.6 22.5 82 Z" fill="' + BELT + '"/>'
      + '<path d="M 22.5 81 C 33 85.6 67 85.6 77.5 81 L 77.5 82.6 C 67 87.2 33 87.2 22.5 82.6 Z" fill="' + BELT_DARK + '"/>'
      + '<path d="M 40 62 Q 50 67 60 62" fill="none" stroke="' + G_DARK + '" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>'

      + '<path d="' + HEAD + '" fill="none" stroke="' + G_LINE + '" stroke-width="3.4"/>'
      + '<path d="' + HEAD + '" fill="url(#gr-body)"/>'
      + '<path d="' + HEAD + '" fill="url(#gr-glow)"/>'

      // Front arm layers.
      + '<g id="__sbwk_la__">' + arm(-1) + '</g>'
      + '<g id="__sbwk_ra__">' + arm(1) + '</g>'

      // Brows. Greeno's whole expression is in these two lines.
      + '<path id="__sbwk_brow_l__" d="M 32 39 Q 38 35.5 44.5 38.5" fill="none" stroke="' + INK + '" stroke-width="2.7" stroke-linecap="round"/>'
      + '<path id="__sbwk_brow_r__" d="M 68 39 Q 62 35.5 55.5 38.5" fill="none" stroke="' + INK + '" stroke-width="2.7" stroke-linecap="round"/>'

      // Eyes at exactly (38,48) and (62,48): the blink scales about those points.
      + '<g id="__sbwk_eye_l__">'
        + '<ellipse cx="38" cy="48" rx="3.1" ry="3.6" fill="' + INK + '"/>'
        + '<g id="__sbwk_pupil_l__"><circle cx="38.9" cy="46.9" r="1" fill="#fff" opacity="0.85"/></g>'
      + '</g>'
      + '<g id="__sbwk_eye_r__">'
        + '<ellipse cx="62" cy="48" rx="3.1" ry="3.6" fill="' + INK + '"/>'
        + '<g id="__sbwk_pupil_r__"><circle cx="62.9" cy="46.9" r="1" fill="#fff" opacity="0.85"/></g>'
      + '</g>'

      // The mouth. Flat and calm at rest, an ellipse while he is talking.
      + '<g id="__sbwk_mouth__">'
        + '<path id="__sbwk_smile__" d="M 43 55.5 Q 50 58.5 57 55.5" fill="none" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>'
        + '<g id="__sbwk_talk__" style="display:none">'
          + '<ellipse id="__sbwk_te__" cx="50" cy="56" rx="4" ry="1.4" fill="' + INK + '"/>'
          + '<ellipse id="__sbwk_ti__" cx="50" cy="56.6" rx="2.4" ry="0.7" fill="#8fce74"/>'
        + '</g>'
      + '</g>'

      // Costumes, kept from the rig so the party tricks still have somewhere to go.
      + '<g id="__sbwk_specs__" display="none">'
        + '<circle cx="38" cy="48" r="8.4" fill="none" stroke="' + INK + '" stroke-width="2.6" opacity="0.92"/>'
        + '<circle cx="62" cy="48" r="8.4" fill="none" stroke="' + INK + '" stroke-width="2.6" opacity="0.92"/>'
        + '<path d="M 46.4 48 L 53.6 48" stroke="' + INK + '" stroke-width="2" stroke-linecap="round" opacity="0.92"/>'
      + '</g>'
      + '<g id="__sbwk_fedora__" display="none" transform="rotate(-10 50 16)">'
        + '<path d="M 34 18 C 34 2 40 -4 50 -4 C 60 -4 66 2 66 18 Z" fill="#14110f"/>'
        + '<ellipse cx="50" cy="18" rx="30" ry="6" fill="#14110f"/>'
      + '</g>'

      + REACT
    + '</g>'
  + '</svg>';

  window.GREENO_WALKER_SVG = SVG;
})();
