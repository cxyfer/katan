import { useId, type ReactNode } from 'react';
import { useT } from '../i18n/context.tsx';
import { TerrainEmblem } from './TerrainArt.tsx';

/** 原創向量圖形只負責呈現，不持有遊戲狀態。 */
export function GameIcon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" /></>,
    ship: <><path d="M12 3v12M12 4 5 12h7M14 7l5 5h-5M3 16l3 4h12l3-4H3ZM2 22q3-2 5 0 3-2 5 0 3-2 5 0 3-2 5 0" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" /></>,
    'arrow-right': <path d="M4 12h16m-6-6 6 6-6 6" />,
    'chevron-right': <path d="m9 5 7 7-7 7" />,
    plus: <path d="M12 4v16M4 12h16" />,
    key: <><circle cx="8" cy="9" r="5" /><path d="m12 13 8 8m-4-4 3-3m-1 5 3-3" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    crown: <path d="m3 6 5 4 4-6 4 6 5-4-2 12H5L3 6Zm3 15h12" />,
    mountain: <path d="m2 20 7-14 5 9 3-6 5 11H2Zm4-8 3 2 3-2" />,
    flag: <path d="M5 22V3m0 1c6-4 8 4 15 0v10c-7 4-9-4-15 0" />,
    book: <><path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1v15" /></>,
    home: <><path d="m2 11 10-8 10 8M5 9v12h14V9M10 21v-7h4v7" /></>,
    city: <><path d="M3 21V9l5-5 5 5v12M13 12l4-4 4 4v9H3M7 21v-6h3v6M7 9h2m7 4h2m-2 4h2" /></>,
    route: <><circle cx="5" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="M7 5h8a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m10 2-1 3-3 1-3-1-1 3 2 3v2l-2 3 1 3 3-1 3 1 1 3h4l1-3 3-1 3 1 1-3-2-3v-2l2-3-1-3-3 1-3-1-1-3h-4Z" /></>,
    shield: <path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-6" />,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    close: <path d="m5 5 14 14M19 5 5 19" />,
    alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4m0 3h.01" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-9h.01" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14m0 3h.01" /></>,
    refresh: <><path d="M20 7a9 9 0 1 0 1 9M20 2v6h-6" /></>,
    cards: <><rect x="7" y="5" width="13" height="16" rx="2" /><path d="m7 17-4-1L5 2l11 2M11 10h5m-5 4h5" /></>,
    sparkles: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4" />,
    chat: <path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4ZM8 10h8m-8 4h5" />,
    trade: <path d="M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5" />,
    scales: <path d="M12 3v18m-5 0h10M4 7h16M4 7l-3 7a3 3 0 0 0 6 0L4 7Zm16 0-3 7a3 3 0 0 0 6 0l-3-7Z" />,
    scroll: <><path d="M6 3h13a3 3 0 0 1 0 6h-2M6 3a3 3 0 0 0-3 3v12a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM6 21h12a3 3 0 0 0 3-3v-3h-4M12 8h2m-2 4h2" /></>,
    dice: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1" /><circle cx="16" cy="8" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="8" cy="16" r="1" /><circle cx="16" cy="16" r="1" /></>,
    sound: <path d="M3 9v6h4l5 4V5L7 9H3Zm13-1a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14" />,
    'sound-off': <path d="M3 9v6h4l5 4V5L7 9H3Zm13 0 6 6m0-6-6 6" />,
    anchor: <><circle cx="12" cy="5" r="3" /><path d="M12 8v14M3 13v3c0 8 18 8 18 0v-3M8 11h8M1 15l2-3 3 3m12 0 3-3 2 3" /></>,
    bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4m-2 0h4M9 13v1m6-1v1M9 17h6M2 13v3m20-3v3" /></>,
    exit: <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />,
    pause: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7m4-7v7" /></>,
    pencil: <><path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13 5 6 6" /></>,
  };
  return <svg className={`game-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name] ?? paths.compass}</svg>;
}

/** 徽記六角格的頂點；`r` 為外接圓半徑。 */
export const emblemCell = (r: number) => `0,${-r} ${r * .866},${-r / 2} ${r * .866},${r / 2} 0,${r} ${-r * .866},${r / 2} ${-r * .866},${-r / 2}`;

/** 徽記中央七格地形：中心先、外圈依順時針。 */
export const EMBLEM_TILES = [
  { x: 0, y: 0, fill: '#e3c173' },
  { x: 0, y: -17.3, fill: '#9eaaa4' },
  { x: 15, y: -8.66, fill: '#d39a72' },
  { x: 15, y: 8.66, fill: '#7f9a69' },
  { x: 0, y: 17.3, fill: '#afc786' },
  { x: -15, y: 8.66, fill: '#d6bb72' },
  { x: -15, y: -8.66, fill: '#6f8c5e' },
] as const;

/** 遊戲徽記：黃銅六角框內的七格地形花窗，對應棋盤的六角地形語彙。 */
export function HexEmblem({ size = 40, className = '' }: { size?: number; className?: string }) {
  const brassId = `hex-emblem-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <svg className={`hex-emblem ${className}`} width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={brassId} x1="0" y1="-1" x2="0" y2="1">
        <stop offset="0" stopColor="#f6dca0" />
        <stop offset=".55" stopColor="#d4a356" />
        <stop offset="1" stopColor="#8f6630" />
      </linearGradient>
    </defs>
    <polygon points={emblemCell(47)} fill={`url(#${brassId})`} />
    <polygon points={emblemCell(41)} fill="#0f3440" />
    <g transform="rotate(30)">
      {EMBLEM_TILES.map((tile) => <polygon key={`${tile.x}:${tile.y}`} points={emblemCell(9.4)} transform={`translate(${tile.x} ${tile.y}) rotate(-30)`} fill={tile.fill} stroke="#0f3440" strokeWidth="1.2" />)}
    </g>
    <path d="M-5 3.5v-4l5-4 5 4v4Z" fill="#c8553d" stroke="#3b2418" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>;
}

export function GameBrand({ compact = false }: { compact?: boolean }) {
  const t = useT();
  return <div className={`game-brand${compact ? ' game-brand--compact' : ''}`}>
    <span className="game-brand__mark"><HexEmblem size={compact ? 34 : 44} /></span>
    <span className="game-brand__name">{t('app.title')}{!compact && <span className="game-brand__tagline">{t('app.tagline')}</span>}</span>
  </div>;
}

/**
 * 大型標題字標，只用在入口畫面；字面即遊戲名稱，作為該頁的 h1。
 */
export function GameLogo({ id }: { id?: string }) {
  const t = useT();
  return <div className="game-logo">
    <HexEmblem size={92} className="game-logo__emblem" />
    <h1 className="game-logo__title" id={id}>{t('app.title')}</h1>
    <p className="game-logo__tagline">{t('app.tagline')}</p>
  </div>;
}

/**
 * 賽前畫面的全幅背景：黃昏天空、遠方島影與緩慢起伏的海浪。
 * 純裝飾，不帶任何遊戲狀態；減少動態偏好下由全域規則停止動畫。
 */
export function PregameScene({ withIsland = false }: { withIsland?: boolean }) {
  const wave = (y: number, amp: number) => {
    let d = `M0 ${y}`;
    for (let x = 0; x < 3200; x += 80) d += ` q20 ${-amp} 40 0 t40 0`;
    return d;
  };
  return <div className="pregame-scene" aria-hidden="true">
    <svg className="pregame-scene__sky" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" focusable="false">
      <defs>
        <linearGradient id="pregame-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d2235" />
          <stop offset=".45" stopColor="#24405a" />
          <stop offset=".78" stopColor="#7d6a6b" />
          <stop offset="1" stopColor="#e2a46c" />
        </linearGradient>
        <linearGradient id="pregame-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f7f80" />
          <stop offset=".25" stopColor="#1d5560" />
          <stop offset="1" stopColor="#06202c" />
        </linearGradient>
        <radialGradient id="pregame-sun-glow">
          <stop offset="0" stopColor="#ffd99a" stopOpacity=".75" />
          <stop offset=".35" stopColor="#f2a865" stopOpacity=".28" />
          <stop offset="1" stopColor="#f2a865" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="472" fill="url(#pregame-sky)" />
      <circle cx="1170" cy="455" r="330" fill="url(#pregame-sun-glow)" />
      <circle cx="1170" cy="452" r="58" fill="#ffe2a8" />
      <g fill="#f5d3a6" opacity=".22" transform="translate(0 -110)">
        <ellipse cx="1320" cy="250" rx="220" ry="8" /><ellipse cx="1220" cy="270" rx="130" ry="5" />
      </g>
      <g transform="translate(0 -130)">
        <path d="M0 600V585l70-14 60 6 90-30 70 22 80 6 50 10 30 15ZM860 600l40-14 70-30 55 20 40 6 35 18Z" fill="#33505c" />
      <path d="M1380 600l50-22 40 8 60-24 70 26v12Z" fill="#2d4855" />
      </g>
      <rect y="468" width="1600" height="432" fill="url(#pregame-sea)" />
      <g fill="#ffe0a8" className="pregame-scene__glint" transform="translate(0 -130)">
        <rect x="1110" y="606" width="120" height="3" rx="1.5" opacity=".7" />
        <rect x="1130" y="620" width="80" height="3" rx="1.5" opacity=".55" />
        <rect x="1095" y="636" width="150" height="3" rx="1.5" opacity=".35" />
        <rect x="1140" y="656" width="60" height="3" rx="1.5" opacity=".3" />
        <rect x="1080" y="680" width="170" height="3" rx="1.5" opacity=".18" />
      </g>
    </svg>
    <svg className="pregame-scene__waves" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" focusable="false">
      <g fill="none" strokeLinecap="round">
        <path className="pregame-scene__wave pregame-scene__wave--far" d={wave(520, 4)} stroke="#a6d3cc" strokeOpacity=".22" strokeWidth="2" />
        <path className="pregame-scene__wave pregame-scene__wave--mid" d={wave(630, 7)} stroke="#a6d3cc" strokeOpacity=".16" strokeWidth="2.5" />
        <path className="pregame-scene__wave pregame-scene__wave--near" d={wave(780, 11)} stroke="#a6d3cc" strokeOpacity=".11" strokeWidth="3" />
      </g>
    </svg>
    {withIsland && <div className="pregame-scene__island"><IslandIllustration /></div>}
  </div>;
}

const RESOURCE_TERRAIN: Readonly<Record<string, string>> = {
  lumber: 'forest', brick: 'hills', wool: 'pasture', grain: 'fields', ore: 'mountains',
};

/**
 * 每種地形／資源的圖示，與棋盤共用同一份畫法；搭配既有文字與符號，不以色彩作唯一辨識。
 * 原點約在圖示中心偏下（地面基線位於 y≈18），維持既有呼叫端的版面。
 */
export function TerrainIllustration({ terrain, x = 0, y = 0, scale = 1 }: { terrain: string; x?: number; y?: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} className="terrain-art" aria-hidden="true" pointerEvents="none">
    <TerrainEmblem terrain={RESOURCE_TERRAIN[terrain] ?? terrain} x={0} y={18} />
  </g>;
}

export function ResourceIcon({ resource, size = 48 }: { resource: string; size?: number }) {
  return <svg width={size} height={size} viewBox="-72 -62 144 105" aria-hidden="true" focusable="false"><TerrainIllustration terrain={resource} /></svg>;
}

const RESOURCE_GLYPHS: Record<string, ReactNode> = {
  lumber: <><path d="M12 2.5 6 10.5h3.2L5 16h5.6v5h2.8v-5H19l-4.2-5.5H18Z" /></>,
  brick: <><path d="M3 14.5h8.2v5H3Zm9.8 0H21v5h-8.2ZM7.4 8.5h9.2v5H7.4ZM3 8.5h3.4v5H3Zm14.6 0H21v5h-3.4Z" /></>,
  wool: <><path d="M5.2 9.6a3 3 0 0 1 4.6-2.8 3.2 3.2 0 0 1 5.6.4 2.9 2.9 0 0 1 1.8 4.7 2.9 2.9 0 0 1-3.4 3.7 3.3 3.3 0 0 1-5.2.1 3 3 0 0 1-3.4-3.6 2.6 2.6 0 0 1 0-2.5Z" /><path d="M17.2 9.8c1.6-.8 3.6.2 3.7 2.2 0 1.5-1.2 2.6-2.7 2.5Z" /><path d="M8 16.5v4m3-4v4m3-4v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
  grain: <><path d="M11.1 21V7.5h1.8V21Z" /><path d="M12 2.3c1.6 1.3 1.6 3.5 0 4.9-1.6-1.4-1.6-3.6 0-4.9Zm-.6 7.4C9.2 9.9 7.6 8.7 7.2 6.6c2.2-.1 3.9 1.1 4.2 3.1Zm1.2 0c.3-2 2-3.2 4.2-3.1-.4 2.1-2 3.3-4.2 3.1Zm-1.2 4.2c-2.2.2-3.8-1-4.2-3.1 2.2-.1 3.9 1.1 4.2 3.1Zm1.2 0c.3-2 2-3.2 4.2-3.1-.4 2.1-2 3.3-4.2 3.1Zm-1.2 4.2c-2.2.2-3.8-1-4.2-3.1 2.2-.1 3.9 1.1 4.2 3.1Zm1.2 0c.3-2 2-3.2 4.2-3.1-.4 2.1-2 3.3-4.2 3.1Z" /></>,
  ore: <><path d="m2.5 19.5 5.8-10 3.3 4.2 3.7-8.2 6.2 14Z" /><path d="m15.3 5.5-1.2 6.2 2.6 2.1M8.3 9.5l.9 4.6" fill="none" stroke="var(--glyph-shade, #0005)" strokeWidth="1.3" strokeLinejoin="round" /></>,
};

/** 扁平的資源符號，用於卡角與數量列；在小尺寸下仍可辨識。 */
export function ResourceGlyph({ resource, size = 18 }: { resource: string; size?: number }) {
  return <svg className="resource-glyph" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">{RESOURCE_GLYPHS[resource]}</svg>;
}

/** 原創首頁插畫；六角島嶼只是裝飾，不呈現虛構遊戲狀態。 */
export function IslandIllustration({ className = '' }: { className?: string }) {
  const hex = '0,-66 57,-33 57,33 0,66 -57,33 -57,-33';
  const tiles = [
    { x: 0, y: -100, terrain: 'mountains', fill: '#9eaaa4' },
    { x: -87, y: -50, terrain: 'forest', fill: '#7f9a69' },
    { x: 87, y: -50, terrain: 'hills', fill: '#d39a72' },
    { x: 0, y: 0, terrain: 'fields', fill: '#e3c173' },
    { x: -87, y: 50, terrain: 'pasture', fill: '#afc786' },
    { x: 87, y: 50, terrain: 'forest', fill: '#7f9a69' },
    { x: 0, y: 100, terrain: 'fields', fill: '#d6bb72' },
  ];
  return <svg className={`island-illustration ${className}`} viewBox="0 0 680 510" fill="none" aria-hidden="true" focusable="false">
    <ellipse cx="340" cy="320" rx="252" ry="151" fill="#3f8f8a" opacity=".45" />
    <ellipse cx="340" cy="312" rx="214" ry="122" fill="#7cc0b2" opacity=".28" />
    <g className="island-illustration__ripples" stroke="#6ba6a4" opacity=".25"><ellipse cx="340" cy="290" rx="273" ry="170" /><ellipse cx="340" cy="290" rx="305" ry="191" strokeDasharray="4 11" /><path d="M27 345h38m-18 12h36m487-168h49m-22 13h42M106 112h29m-13 11h44" /></g>
    <g transform="translate(340 251) rotate(-8) scale(1.07 .84)">
      {/* 與棋盤一致的淺水與沙灘：放大的六角形彼此重疊成連續的海岸。 */}
      {tiles.map((tile) => <polygon key={`shallow-${tile.x}-${tile.y}`} points={hex} transform={`translate(${tile.x} ${tile.y + 10}) scale(1.62)`} fill="#8ed6c8" opacity=".38" />)}
      {tiles.map((tile) => <polygon key={`surf-${tile.x}-${tile.y}`} points={hex} transform={`translate(${tile.x} ${tile.y + 12}) scale(1.36)`} fill="#d9f3ea" />)}
      {tiles.map((tile) => <polygon key={`sand-${tile.x}-${tile.y}`} points={hex} transform={`translate(${tile.x} ${tile.y + 12}) scale(1.28)`} fill="#e9d29d" />)}
      {tiles.map((tile) => <g key={`${tile.x}-${tile.y}`} transform={`translate(${tile.x} ${tile.y})`}><polygon points={hex} transform="translate(0 16)" fill="#8d6f48" stroke="#5f4a31" strokeWidth="3" /><polygon points={hex} fill={tile.fill} stroke="#5d5440" strokeOpacity=".55" strokeWidth="3" /><polygon points="0,-57 49,-28 49,28 0,57 -49,28 -49,-28" stroke="#fff4cc" opacity=".3" /><TerrainIllustration terrain={tile.terrain} y={-6} scale={.76} /></g>)}
      <path d="m-57-84 0 66 57 34 57-34" stroke="#5c3e2c" strokeWidth="11" strokeLinecap="round" /><path d="m-57-84 0 66 57 34 57-34" stroke="#dc9e58" strokeWidth="7" strokeLinecap="round" />
      {[{ x: -57, y: -84 }, { x: 57, y: -18 }].map(({ x, y }) => <g key={x} transform={`translate(${x} ${y})`}><path d="M-13-3 0-16 13-3v19h-26Z" fill="#e9ba7a" stroke="#63442e" strokeWidth="2" /><path d="m-17-2 17-18 17 18" fill="#d36e4d" stroke="#663d2d" strokeWidth="2" /><path d="M-3 5h6v11h-6Z" fill="#765744" /></g>)}
    </g>
    <g transform="translate(552 355) rotate(9)"><path d="M-28 7h58L18 23h-35Z" fill="#ba8350" stroke="#e6c695" strokeWidth="2" /><path d="M1-52V7M1-48-25-3H1Z" fill="#f4dfb0" stroke="#d6ba81" strokeWidth="2" /><path d="M7-33 28-3H7Z" fill="#c98b59" /><path d="M-38 32q13-7 26 0t26 0 26 0" stroke="#87c3bf" strokeWidth="2" /></g>
    <g transform="translate(116 397)" stroke="#bfa16c" opacity=".75"><circle r="27" /><path d="M0-37v74M-37 0h74" /><path d="m0-22 6 16 16 6-16 6-6 16-6-16-16-6 16-6Z" fill="#d7bb80" /><circle r="4" fill="#102d38" /></g>
    <g fill="#d8cba7" opacity=".75"><path d="m121 72 5-5 5 5m13-5 5-5 5 5M530 95l5-5 5 5m5 8 5-5 5 5" stroke="#d8cba7" strokeWidth="2" fill="none" /></g>
  </svg>;
}
