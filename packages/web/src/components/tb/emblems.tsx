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

/** A gold coin. */
export function CoinEmblem({ size }: { size?: number }) {
  return (
    <Emblem size={size}>
      <circle cx="16" cy="16" r="13" fill="#d9a62e" stroke="#8a6414" strokeWidth="2" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#f6dc8a" strokeWidth="1.5" />
      <path d="M13 11h6l-3 4 3 0-6 6" fill="none" stroke="#8a6414" strokeWidth="1.8" strokeLinecap="round" />
    </Emblem>
  );
}

/** A bridge arch over water. */
export function BridgeEmblem({ size }: { size?: number }) {
  return (
    <Emblem size={size}>
      <rect x="1.5" y="18" width="29" height="11" rx="3" fill="#3d8eb4" />
      <path d="M3 18q13-12 26 0v4q-13-9-26 0Z" fill="#8a6a48" stroke="#4c3626" strokeWidth="1" />
      <path d="M8 14v5M16 11v6M24 14v5" stroke="#4c3626" strokeWidth="1.2" />
    </Emblem>
  );
}

/** A purse of coins (Wealthiest) or an empty patched pouch (Poor). */
export function WealthEmblem({ size, poor = false }: { size?: number; poor?: boolean }) {
  return (
    <Emblem size={size}>
      <path d="M10 10h12l3 4q4 6 0 12-9 4-18 0-4-6 0-12Z" fill={poor ? '#9a8e78' : '#b23a3a'} stroke="#3a2414" strokeWidth="1.2" />
      <path d="M11 10q5-4 10 0" fill="none" stroke="#3a2414" strokeWidth="1.5" />
      {poor
        ? <path d="M12 18h8M14 22h4" stroke="#3a2414" strokeWidth="1.2" />
        : <><circle cx="13" cy="19" r="2.6" fill="#f2c94c" /><circle cx="19" cy="21" r="2.6" fill="#f2c94c" /></>}
    </Emblem>
  );
}

/** A neutral trade wagon (Merchant Trains) or a player's wagon when coloured. */
export function WagonEmblem({ size, color = '#9aa3a6' }: { size?: number; color?: string }) {
  return (
    <Emblem size={size}>
      <path d="M5 18h22v-6q-11-7-22 0Z" fill={color} stroke="#2e2a24" strokeWidth="1.4" />
      <rect x="4" y="17" width="24" height="5" rx="1.5" fill="#7b5230" stroke="#2e2a24" strokeWidth="1.2" />
      <circle cx="10" cy="24" r="3.4" fill="#4c3626" stroke="#e6d3b0" strokeWidth="1" />
      <circle cx="22" cy="24" r="3.4" fill="#4c3626" stroke="#e6d3b0" strokeWidth="1" />
    </Emblem>
  );
}

/** A barbarian raider. */
export function BarbarianEmblem({ size }: { size?: number }) {
  return (
    <Emblem size={size}>
      <circle cx="16" cy="9" r="5" fill="#8a8f93" stroke="#2e2a24" strokeWidth="1.2" />
      <path d="M11 6l-3-3M21 6l3-3" stroke="#d8d2c2" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 29v-9q0-6 7-6t7 6v9Z" fill="#8a8f93" stroke="#2e2a24" strokeWidth="1.2" />
      <path d="M23 18l5-6" stroke="#5b4630" strokeWidth="2" strokeLinecap="round" />
    </Emblem>
  );
}

/** A knight with a pennant in the player's colour. */
export function KnightEmblem({ size, color = '#c0392b' }: { size?: number; color?: string }) {
  return (
    <Emblem size={size}>
      <path d="M10 29v-8q0-7 6-7t6 7v8Z" fill={color} stroke="#2e2a24" strokeWidth="1.2" />
      <circle cx="16" cy="10" r="5" fill="#c9cdd0" stroke="#2e2a24" strokeWidth="1.2" />
      <path d="M13 10h6" stroke="#2e2a24" strokeWidth="1.2" />
      <path d="M24 4v18M24 4l5 2-5 2" stroke="#2e2a24" strokeWidth="1.4" fill={color} />
    </Emblem>
  );
}

/** A castle gate. */
export function CastleEmblem({ size }: { size?: number }) {
  return (
    <Emblem size={size}>
      <path d="M4 29V12h4v3h4v-3h8v3h4v-3h4v17Z" fill="#b9b2a2" stroke="#2e2a24" strokeWidth="1.2" />
      <path d="M13 29v-7q3-4 6 0v7Z" fill="#5a3d26" />
      <path d="M8 12V6l2 2 2-2v6M20 12V6l2 2 2-2v6" fill="#b5523a" />
    </Emblem>
  );
}

const COMMODITY_TINT: Record<string, string> = { marble: '#f1eee6', sand: '#e6c27a', glass: '#6fb6d8', tools: '#8a8f93' };

/** A commodity token: marble block, sand heap, glass pane or tools. */
export function CommodityEmblem({ size, commodity }: { size?: number; commodity: string }) {
  const tint = COMMODITY_TINT[commodity] ?? '#cccccc';
  return (
    <Emblem size={size}>
      <rect x="1.5" y="1.5" width="29" height="29" rx="5" fill="#f2c94c" stroke="#8a6414" strokeWidth="1.5" />
      {commodity === 'marble' && <path d="M7 22l4-9h12l3 9Z" fill={tint} stroke="#6b6458" strokeWidth="1.2" />}
      {commodity === 'sand' && <path d="M5 24q11-16 22 0Z" fill={tint} stroke="#8a6a3a" strokeWidth="1.2" />}
      {commodity === 'glass' && <><rect x="10" y="7" width="12" height="18" rx="5" fill={tint} stroke="#3d5a6a" strokeWidth="1.2" /><path d="M16 7v18M10 16h12" stroke="#3d5a6a" strokeWidth="1" /></>}
      {commodity === 'tools' && <path d="M9 23l12-12M11 9l4 4-3 3-4-4ZM20 23l-8-8" stroke="#3a2a1c" strokeWidth="2.4" strokeLinecap="round" fill={tint} />}
    </Emblem>
  );
}
