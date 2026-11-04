import type { ReactNode } from 'react';

/**
 * Original emblems for the Traders & Barbarians hexes, drawn like the base
 * terrain emblems (`TerrainArt.tsx`): ground line at the origin, about ±60
 * wide and 64 tall. Plain shapes only, no official artwork.
 */

function Plate({ fill, light }: { fill: string; light: string }) {
  return <>
    <ellipse cy="4" rx="60" ry="11" fill="#1d2a20" opacity=".22" />
    <ellipse cy="0" rx="58" ry="10" fill={fill} />
    <ellipse cy="-2" rx="50" ry="6.5" fill={light} opacity=".55" />
  </>;
}

function Reed({ x, h }: { x: number; h: number }) {
  return <g>
    <path d={`M${x} 0q-1 ${-h / 2} 2 ${-h}`} stroke="#5f7d3a" strokeWidth="2" fill="none" strokeLinecap="round" />
    <ellipse cx={x + 2} cy={-h + 4} rx="2.2" ry="5" fill="#7b5a34" />
  </g>;
}

function Hut({ x, y, s = 1, roof = '#9b4f32' }: { x: number; y: number; s?: number; roof?: string }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cy="2" rx="15" ry="3.5" fill="#1d2a20" opacity=".25" />
    <path d="M-12 0v-14h24V0Z" fill="#d9c49a" />
    <path d="M-15-13 0-25 15-13Z" fill={roof} />
    <path d="M-3 0v-8h6V0Z" fill="#6b4a2e" />
  </g>;
}

function Tower({ x, y, h = 30, w = 12 }: { x: number; y: number; h?: number; w?: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M${-w / 2} 0V${-h}h${w}V0Z`} fill="#a19a8c" />
    <path d={`M${w / 2} 0V${-h}h${-w / 3}V0Z`} fill="#7d776c" />
    <path d={`M${-w / 2 - 2} ${-h}l${w / 2 + 2} -12l${w / 2 + 2} 12Z`} fill="#b5523a" />
  </g>;
}

/** Emblem art for a T&B hex type, or null for any other terrain. */
export function tbTerrainArt(terrain: string): ReactNode | null {
  switch (terrain) {
    case 'lake':
      return <>
        <Plate fill="#6f9f63" light="#a5c98a" />
        <path d="M-46-6c4-16 30-26 50-24s38 10 38 22-26 14-46 13-46 0-42-11Z" fill="#3d8eb4" />
        <path d="M-34-10c8-10 26-15 40-14M8-6c10-1 22-4 28-9" stroke="#c9eef7" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* A small rowing boat and reeds at the shore. */}
        <path d="M-6-17h20l-4 5h-12Z" fill="#7a5032" />
        <path d="M4-17v-9" stroke="#5b3b22" strokeWidth="1.6" />
        <Reed x={-48} h={22} /><Reed x={-42} h={18} /><Reed x={44} h={20} />
      </>;
    case 'swamp':
      return <>
        <Plate fill="#7b7a45" light="#a8a466" />
        <path d="M-50-4c10-6 24-8 36-4s30 2 42-3 18 1 22 6" fill="none" stroke="#4f8ea3" strokeWidth="5" strokeLinecap="round" />
        <path d="M-38-12c8-3 16-3 22 0M6-14c8-2 16-1 22 2" fill="none" stroke="#4f8ea3" strokeWidth="3" strokeLinecap="round" />
        <Reed x={-30} h={30} /><Reed x={-22} h={24} /><Reed x={18} h={28} /><Reed x={26} h={22} /><Reed x={40} h={18} />
        <ellipse cx="-4" cy="-20" rx="9" ry="4" fill="#5a7d3c" />
      </>;
    case 'oasis':
      return <>
        <Plate fill="#d8b77a" light="#f3e0b2" />
        <ellipse cx="6" cy="-8" rx="26" ry="9" fill="#3d9cc0" />
        <path d="M-6-10c6-3 16-4 24-1" stroke="#d6f3fa" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        {/* Palm tree and a trader's tent. */}
        <path d="M-30 0q-2-20 4-34" stroke="#7a5638" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M-26-34q-14-4-22 6M-26-34q-4-12-16-12M-26-34q8-10 20-6M-26-34q12 0 16 10" stroke="#4e8b47" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M30 0l14-24 14 24Z" fill="#c9502f" /><path d="M44-24 44 0" stroke="#7d2f1c" strokeWidth="1.5" />
      </>;
    case 'castle':
    case 'keep':
      return <>
        <Plate fill="#6f9f55" light="#a8cc84" />
        <path d="M-26 0v-26h52V0Z" fill="#b9b2a2" />
        <path d="M-26-26v-6h8v4h6v-4h8v4h8v-4h8v4h6v-4h8v6Z" fill="#9b9484" />
        <path d="M-6 0v-14q6-8 12 0V0Z" fill="#5a3d26" />
        <Tower x={-30} y={0} h={38} /><Tower x={30} y={0} h={38} /><Tower x={0} y={-26} h={18} w={10} />
        {terrain === 'keep' && <path d="M40-44v-14l10 4-10 4" stroke="#6b4a2e" strokeWidth="1.5" fill="#d4a236" />}
      </>;
    case 'quarry':
      return <>
        <Plate fill="#b06c45" light="#dba07a" />
        <path d="M-44 0l10-30h40l16 18 22-4L52 0Z" fill="#e5e1d6" />
        <path d="M-34-30h40l16 18H-26Z" fill="#c9c3b5" />
        <path d="M-20-16h10v-8h10v8h12" stroke="#a49d8f" strokeWidth="1.6" fill="none" />
        {/* Crane frame and a marble block. */}
        <path d="M30-2V-44h4V-2M32-44h-26M14-44v12" stroke="#6d4b31" strokeWidth="3" fill="none" />
        <rect x="6" y="-32" width="14" height="10" fill="#f4f1ea" stroke="#a49d8f" />
      </>;
    case 'glassworks':
      return <>
        <Plate fill="#4c7a45" light="#78a565" />
        <path d="M-30 0v-26h44V0Z" fill="#c9a77a" />
        <path d="M-34-26 -8-42 18-26Z" fill="#8f4a2f" />
        <path d="M2-34v-16h8v12" fill="#7d776c" />
        <path d="M6-52q4-6 0-12" stroke="#d9d9d9" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".8" />
        {/* A glowing furnace mouth and stained-glass panes. */}
        <path d="M-22 0v-10q6-6 12 0V0Z" fill="#f3a531" />
        <rect x="-4" y="-20" width="12" height="12" fill="#6fb6d8" stroke="#3d5a6a" />
        <path d="M2-20v12M-4-14h12" stroke="#3d5a6a" strokeWidth="1.2" />
        <Hut x={34} y={0} s={0.8} roof="#6d8a3c" />
      </>;
    default:
      return null;
  }
}
