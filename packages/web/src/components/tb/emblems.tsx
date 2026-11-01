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
