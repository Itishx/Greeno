import React from "react";

// The mascot, drawn small. The full rig with the walk cycle lives in the Mac
// app; this is his portrait.
export default function Greeno({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <linearGradient id="g-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ecb6a" /><stop offset="1" stopColor="#3f7a34" />
        </linearGradient>
      </defs>
      <path d="M 50 16 C 62 16 70 23 70 37 C 70 51 63 59 50 59 C 37 59 30 51 30 37 C 30 23 38 16 50 16 Z"
            transform="translate(6 14) scale(1.1) translate(-6 -14)" fill="none" stroke="#356b2c" strokeWidth="3.4" />
      <path d="M 50 16 C 62 16 70 23 70 37 C 70 51 63 59 50 59 C 37 59 30 51 30 37 C 30 23 38 16 50 16 Z"
            transform="translate(6 14) scale(1.1) translate(-6 -14)" fill="url(#g-body)" />
      <path d="M 36 43 Q 44 38 52 42" fill="none" stroke="#1b2a16" strokeWidth="3" strokeLinecap="round" />
      <path d="M 76 43 Q 68 38 60 42" fill="none" stroke="#1b2a16" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="44" cy="54" rx="3.3" ry="3.9" fill="#1b2a16" />
      <ellipse cx="68" cy="54" rx="3.3" ry="3.9" fill="#1b2a16" />
      <path d="M 49 64 Q 56 68 63 64" fill="none" stroke="#1b2a16" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
