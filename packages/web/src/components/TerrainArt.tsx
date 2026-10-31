import type { ReactNode } from 'react';

/**
 * 地形圖示：棋盤、首頁島嶼插畫、資源卡與資源小圖示共用的原創向量圖。
 * 每個圖示以地面基線為原點，寬約 ±60、高約 64 個 SVG 單位；只負責呈現。
 */

function Pine({ x, y, s = 1, tone = 0 }: { x: number; y: number; s?: number; tone?: number }) {
  const dark = ['#24513b', '#2c5a3f', '#1f4734'][tone % 3]!;
  const light = ['#3f7a4f', '#4a8656', '#36704a'][tone % 3]!;
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cy="2" rx="12" ry="3.5" fill="#173022" opacity=".28" />
    <rect x="-2" y="-8" width="4" height="10" fill="#6d4b31" />
    <path d="M0-44-13-18h6l-10 13h34L7-18h6Z" fill={dark} />
    <path d="M0-44v39h17L7-18h6Z" fill={light} opacity=".55" />
    <path d="M0-44l-7 14M0-30l-9 15" stroke="#7fb27a" strokeWidth="1.4" opacity=".55" fill="none" />
  </g>;
}

function Broadleaf({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cy="2" rx="12" ry="3.5" fill="#173022" opacity=".28" />
    <path d="M-1.5 1v-16h3V1Z" fill="#7a5638" />
    <circle cx="-7" cy="-20" r="9" fill="#5d8d4a" /><circle cx="6" cy="-22" r="10" fill="#6c9a50" />
    <circle cx="0" cy="-30" r="9" fill="#7aa85a" /><circle cx="-3" cy="-31" r="3.5" fill="#b8d58a" opacity=".55" />
  </g>;
}

function Peak({ x, y, w, h, snow = true }: { x: number; y: number; w: number; h: number; snow?: boolean }) {
  const half = w / 2;
  const cap = h * 0.36;
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M${-half} 0L0 ${-h}L${half} 0Z`} fill="#8b979a" />
    <path d={`M0 ${-h}L${half} 0H${half * 0.15}Z`} fill="#5e6c72" />
    <path d={`M0 ${-h}L${-half * 0.35} ${-h * 0.45}L${-half * 0.55} 0`} fill="none" stroke="#b1bcbb" strokeWidth="1.5" opacity=".6" />
    {snow && <path d={`M0 ${-h}L${-half * cap / h} ${-h + cap}l${half * 0.16} ${-cap * 0.22}l${half * 0.14} ${cap * 0.3}l${half * 0.16} ${-cap * 0.34}L${half * cap / h} ${-h + cap}Z`} fill="#f7f6ee" />}
    {snow && <path d={`M0 ${-h}L${half * cap / h} ${-h + cap}l${-half * 0.12} ${-cap * 0.3}Z`} fill="#d5dedf" />}
  </g>;
}

function Rock({ x, y, s = 1, fill = '#9aa19b' }: { x: number; y: number; s?: number; fill?: string }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-7 2-5-4 0-6 6-3 7 2Z" fill={fill} /><path d="M0-6 6-3 7 2H1Z" fill="#000" opacity=".18" />
  </g>;
}

/** 一組圓合成單一路徑；同色重疊的圓填色結果與分開繪製相同，但 DOM 節點少得多。 */
function circles(list: readonly (readonly [number, number, number])[], grow = 0): string {
  return list.map(([cx, cy, r]) => {
    const radius = r + grow;
    return `M${cx - radius} ${cy}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`;
  }).join('');
}

const WOOL: readonly (readonly [number, number, number])[] = [
  [-13, -19, 8], [-4, -24, 9], [7, -23, 8.5], [14, -16, 7.5], [-15, -11, 7.5], [-4, -11, 9], [8, -11, 8.5],
];
const WOOL_OUTLINE = circles(WOOL, 1.4);
const WOOL_FILL = circles(WOOL);

function Sheep({ x, y, s = 1, flip = false }: { x: number; y: number; s?: number; flip?: boolean }) {
  // 捲毛身體由重疊圓構成：先畫略大的描邊圓，再畫毛色圓，最後點出毛捲。
  return <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
    <ellipse cy="1" rx="22" ry="3.6" fill="#24401c" opacity=".28" />
    <path d="M-12.2-10h4.4v10.5h-4.4ZM7.8-10h4.4v10.5h-4.4Z" fill="#3a312a" />
    <path d={WOOL_OUTLINE} fill="#cfc6aa" />
    <path d={WOOL_FILL} fill="#f8f3e3" />
    <path d="M-17-8q8 5 16 2t16-1M-9-24q2-3 5-1M3-27q2-3 5 0M-14-16q2-3 5-1" fill="none" stroke="#e2d9bf" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M-16.2-7h4.4v7.5h-4.4ZM2.8-7h4.4v7.5h-4.4Z" fill="#4b4037" />
    <g transform="translate(19 -21) rotate(18)">
      <ellipse cx="-3" cy="-6" rx="5.2" ry="2.4" transform="rotate(-35 -3 -6)" fill="#3a312a" />
      <ellipse rx="6.4" ry="8.6" fill="#4d433a" />
      <ellipse cx="1.5" cy="5" rx="4" ry="3.4" fill="#6b5f53" />
      <circle cx="2.2" cy="-1.5" r="1.5" fill="#fbf6e6" /><circle cx="2.6" cy="-1.3" r=".7" fill="#1d1915" />
      <ellipse cx="3" cy="-6.5" rx="5" ry="2.2" transform="rotate(10 3 -6.5)" fill="#5c5046" />
      <path d={circles([[-2.5, -8.4, 3], [0.5, -9.4, 2.6]])} fill="#f8f3e3" />
    </g>
  </g>;
}

/** A soft earthen plate that every emblem stands on. */
function Ground({ fill, light, w = 118 }: { fill: string; light: string; w?: number }) {
  const half = w / 2;
  return <>
    <ellipse cy="5" rx={half + 2} ry="9" fill="#0d1d16" opacity=".2" />
    <path d={`M${-half} 2q${half} -26 ${w} 0q${-half} 10 ${-w} 0Z`} fill={fill} />
    <path d={`M${-half * 0.62} -6q${half * 0.62} -14 ${half * 1.24} 0`} fill="none" stroke={light} strokeWidth="2.4" strokeLinecap="round" opacity=".75" />
  </>;
}

function Cactus({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const outline = 'M0 0V-31M0-13h-5q-4 0-4-4v-7M0-19h5q4 0 4-4v-5';
  return <g transform={`translate(${x} ${y}) scale(${s})`} strokeLinecap="round" strokeLinejoin="round" fill="none">
    <ellipse cy="1" rx="9" ry="2.4" fill="#7a5f33" opacity=".28" stroke="none" />
    <path d={outline} stroke="#3c6644" strokeWidth="7" />
    <path d={outline} stroke="#5e9161" strokeWidth="5" />
    <path d="M-1.5-2v-27M-10-16v-6M7.5-22v-4" stroke="#a9d192" strokeWidth="1.3" opacity=".85" />
  </g>;
}

/** 立體磚的三個面與刻線；原點在正面左下角，可串接多塊為單一路徑。 */
function brickFaces(x: number, y: number) {
  return {
    top: `M${x} ${y - 7}l4-3.5h14l-4 3.5Z`,
    side: `M${x + 14} ${y - 7}l4-3.5v7l-4 3.5Z`,
    front: `M${x} ${y - 7}h14v7h-14Z`,
    groove: `M${x + 1.6} ${y - 4.6}h10.8`,
  };
}

function Brick({ x, y }: { x: number; y: number }) {
  const faces = brickFaces(x, y);
  return <BrickFaces faces={[faces]} />;
}

/** 依頂面、側面、正面的順序繪製，後繪的正面蓋住前一塊的側面，與逐塊疊放的結果相同。 */
function BrickFaces({ faces }: { faces: readonly ReturnType<typeof brickFaces>[] }) {
  const join = (key: keyof ReturnType<typeof brickFaces>) => faces.map((face) => face[key]).join('');
  return <g strokeLinejoin="round" stroke="#7d3a24" strokeWidth=".9">
    <path d={join('top')} fill="#eda27c" />
    <path d={join('side')} fill="#9c4d33" />
    <path d={join('front')} fill="#c96b4a" />
    <path d={join('groove')} stroke="#e08a66" strokeWidth="1" />
  </g>;
}

const BRICK_STACK = ([[-21, -7, 7], [-14, 0], [-7]] as const).flatMap((row, level) => row.map((bx) => brickFaces(bx, -level * 7)));

function BrickStack({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="2" cy="1" rx="26" ry="4.2" fill="#4a2414" opacity=".28" />
    <BrickFaces faces={BRICK_STACK} />
  </g>;
}

function WheatStalk({ x, h, lean }: { x: number; h: number; lean: number }) {
  // 左右兩排麥粒各合成一條路徑，每株只需七個節點。
  const rows = [0, 1, 2, 3].map((k) => -h + 6 + k * 6.5);
  const left = rows.map((ky) => `M0 ${ky}q-7-1-7.5-7.5q6 1 7.5 6Z`).join('');
  const right = rows.map((ky) => `M0 ${ky}q7-1 7.5-7.5q-6 1-7.5 6Z`).join('');
  return <g transform={`translate(${x} 0) rotate(${lean})`}>
    <path d={`M0 0V${-h}`} stroke="#9c7426" strokeWidth="2" strokeLinecap="round" />
    <path d={`M0 ${-h * 0.35}q-9-4-11-12q8 2 11 9`} fill="#c9a447" />
    <path d={left} fill="#f1cf6e" stroke="#b78a2e" strokeWidth=".8" />
    <path d={right} fill="#e4bb55" stroke="#b78a2e" strokeWidth=".8" />
    <path d={`M0 ${-h - 1}q-1.6-4 0-8 1.6 4 0 8Z`} fill="#f6da86" stroke="#b78a2e" strokeWidth=".8" />
    <path d={`M-2 ${-h - 4}l-5-10M2 ${-h - 4}l5-10M0 ${-h - 8}v-9`} stroke="#d7b257" strokeWidth=".9" />
  </g>;
}

function Fence({ from, to, y }: { from: number; to: number; y: number }) {
  const posts = Math.round((to - from) / 14);
  return <g>
    <path d={`M${from} ${y - 9}H${to}M${from} ${y - 4}H${to}`} stroke="#c4a679" strokeWidth="2" />
    {Array.from({ length: posts + 1 }, (_, index) => <path key={index} d={`M${from + index * (to - from) / posts} ${y}v-13`} stroke="#8e7254" strokeWidth="2.6" strokeLinecap="round" />)}
  </g>;
}

/**
 * One centred emblem per terrain, like a printed tile icon: a single motif on
 * an earthen plate, sitting above the number token.
 */
export function TerrainEmblem({ terrain, x, y }: { terrain: string; x: number; y: number }) {
  let art: ReactNode;
  switch (terrain) {
    case 'forest':
      art = <>
        <Ground fill="#4c7a45" light="#78a565" />
        <Broadleaf x={-40} y={-2} s={.82} /><Pine x={40} y={-1} s={.92} tone={2} />
        <Pine x={-17} y={1} s={1.08} tone={1} /><Pine x={14} y={3} s={1.32} />
      </>;
      break;
    case 'mountains':
    case 'gold':
      art = <>
        <Ground fill={terrain === 'gold' ? '#8c7d4e' : '#76817f'} light={terrain === 'gold' ? '#c9b46a' : '#a4aca6'} />
        <Peak x={-30} y={-2} w={58} h={44} /><Peak x={32} y={-2} w={54} h={40} /><Peak x={0} y={-1} w={74} h={64} />
        <Rock x={-38} y={3} s={1.1} /><Rock x={42} y={4} s={.9} fill="#8a918b" />
        {terrain === 'gold' && <><Rock x={14} y={4} s={1.3} fill="#e0b84a" /><Rock x={-12} y={5} s={1} fill="#f0d070" /></>}
      </>;
      break;
    case 'hills':
      art = <>
        <Ground fill="#a75e3c" light="#d99a70" />
        {/* 背後的紅土丘：岩層條紋、背光面與零星草叢。 */}
        <path d="M-56 1C-50-30-22-50 0-50S44-28 52 1Z" fill="#c27650" />
        <path d="M0-50C22-50 44-28 52 1H16C20-20 14-38 0-50Z" fill="#8f4a2f" opacity=".35" />
        <path d="M-48-14Q0-28 49-12M-41-28Q-4-40 38-27M-26-41Q0-48 22-41" fill="none" stroke="#a35a3a" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M-50-8Q0-21 50-6" fill="none" stroke="#e1a47b" strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
        <path d="M-16-49q6-6 14-3 6-4 12 1-12-2-26 2Z" fill="#8fa35a" />
        <path d="M-42-20q3-5 8-3-4 0-8 3ZM30-30q3-4 7-1-4-1-7 1Z" fill="#8fa35a" />
        <BrickStack x={20} y={6} s={1.05} />
        <Brick x={-38} y={6} />
      </>;
      break;
    case 'fields':
      art = <>
        <Ground fill="#c29a3e" light="#ecd07a" />
        <WheatStalk x={-30} h={38} lean={-14} /><WheatStalk x={30} h={38} lean={14} />
        <WheatStalk x={-14} h={48} lean={-6} /><WheatStalk x={14} h={48} lean={6} /><WheatStalk x={0} h={56} lean={0} />
      </>;
      break;
    case 'pasture':
      art = <>
        <Ground fill="#7aa956" light="#b4d283" />
        <Fence from={18} to={54} y={-9} />
        <Sheep x={-38} y={-5} s={.78} />
        <Sheep x={4} y={4} s={1.3} />
        <circle cx={-40} cy={2} r={2.6} fill="#f3e6a8" /><circle cx={46} cy={3} r={2.4} fill="#eaaaa4" />
      </>;
      break;
    case 'desert':
      art = <>
        <Ground fill="#d8b77a" light="#f3e0b2" />
        {/* 遠方不規則的砂岩丘，前方兩道沙丘有受光面與背風陰影。 */}
        <path d="M-48 0l3-13 8-4 4-11 7-3h14l4 9 7 2 3 20Z" fill="#cf9161" />
        <path d="M-10-31h4l4 9 7 2 3 20H-6l2-14Z" fill="#9c5c37" opacity=".35" />
        <path d="M-37-17l4-11 7-3h14M-44-9h44" fill="none" stroke="#e7b585" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M-60 2C-44-17-20-20-2-6 10-17 34-20 60 2Z" fill="#ecd29a" />
        <path d="M-2-6C10-17 34-20 60 2H24C30-6 14-12-2-6ZM-60 2C-44-17-20-20-2-6-14-2-34-2-60 2Z" fill="#c9a26a" opacity=".45" />
        <path d="M-50-5C-38-14-20-15-6-7M6-10C18-16 34-15 50-4" fill="none" stroke="#fff1cc" strokeWidth="1.3" strokeLinecap="round" opacity=".75" />
        <Cactus x={30} y={0} s={1.25} />
        <Rock x={-34} y={3} s={.9} fill="#c4a27a" /><Rock x={-22} y={4} s={.55} fill="#b38f66" />
      </>;
      break;
    default:
      art = <path d="M-40-10q10-8 20 0t20 0 20 0 20 0M-40 10q10-8 20 0t20 0 20 0 20 0" fill="none" stroke="#bfe6df" strokeWidth="2.5" />;
  }
  return <g transform={`translate(${x} ${y})`} className="terrain-emblem" aria-hidden="true" pointerEvents="none">{art}</g>;
}
