/**
 * Hand-drawn SVG emblems for Traders & Barbarians pieces and tokens. Original
 * shapes only — no official artwork. Every emblem is decorative (`aria-hidden`);
 * the surrounding text carries the meaning.
 */

import type { ReactNode } from 'react';

function Emblem({ size = 20, children, className }: { size?: number; children: ReactNode; className?: string }) {
  return (
    <svg className={`tb-emblem${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 32 32"
      aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Strongest Ports: an anchor under a small crown. */
export function StrongestPortsEmblem({ size }: { size?: number }) {
  return (
    <Emblem size={size}>
      <circle cx="16" cy="16" r="15" fill="#1d5e7a" />
      <path d="M10 7l2.2 3 3.8-4 3.8 4L22 7l-1 5H11z" fill="#f2c94c" />
      <g fill="none" stroke="#f6f1e1" strokeWidth="2.2" strokeLinecap="round">
        <path d="M16 13v13" />
        <path d="M12 16h8" />
        <path d="M8.5 20.5c1.5 4 4.5 5.5 7.5 5.5s6-1.5 7.5-5.5" />
      </g>
    </Emblem>
  );
}

/** A fish token: one to three fish on a blue square. */
export function FishEmblem({ size, value = 1 }: { size?: number; value?: number }) {
  const rows = Math.max(1, Math.min(3, value));
  return (
    <Emblem size={size}>
      <rect x="1.5" y="1.5" width="29" height="29" rx="5" fill="#2f88ac" stroke="#c9eef7" strokeWidth="1.5" />
      {Array.from({ length: rows }, (_, index) => {
        const y = 16 + (index - (rows - 1) / 2) * 8;
        return <g key={index} transform={`translate(16 ${y})`}>
          <path d="M-9 0q5-5 11-2l5-3v10l-5-3q-6 3-11-2Z" fill="#f4e7c3" />
          <circle cx="-5" cy="-0.8" r="0.9" fill="#1b3a46" />
        </g>;
      })}
    </Emblem>
  );
}

/** The old boot token. */
export function BootEmblem({ size }: { size?: number }) {
  return (
    <Emblem size={size}>
      <rect x="1.5" y="1.5" width="29" height="29" rx="5" fill="#2f88ac" stroke="#c9eef7" strokeWidth="1.5" />
      <path d="M11 6h8v12l6 3q2 2 0 4H8v-6l3-2Z" fill="#7b5230" stroke="#3a2414" strokeWidth="1.2" />
      <path d="M8 25h18" stroke="#3a2414" strokeWidth="2" />
      <path d="M12 10h6M12 13h6" stroke="#c49a6c" strokeWidth="1" />
    </Emblem>
  );
}
