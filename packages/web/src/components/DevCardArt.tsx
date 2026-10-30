import { memo, useId, type ReactNode } from 'react';

type Palette = { sky: string; light: string; far: string; near: string; ground: string };

const PALETTES: Record<string, Palette> = {
  knight: { sky: '#7b86a8', light: '#e9dcc0', far: '#68708f', near: '#4c5574', ground: '#2c3350' },
  roadBuilding: { sky: '#9fb6ae', light: '#f4dfb0', far: '#a08668', near: '#87704f', ground: '#5c4630' },
  yearOfPlenty: { sky: '#97c0a9', light: '#fbefbe', far: '#86a86c', near: '#6c9452', ground: '#3f6a37' },
  monopoly: { sky: '#a98aa6', light: '#f6dfc0', far: '#8c6787', near: '#704d6c', ground: '#452c45' },
  victoryPoint: { sky: '#c0b07a', light: '#fff1c4', far: '#a99456', near: '#8c773b', ground: '#5f4d1f' },
};

/** 每種發展卡的主圖；只畫在前景，背景天空與丘陵沿用資源牌的構圖。 */
const MOTIFS: Record<string, ReactNode> = {
  knight: <g>
    <path d="M124 64v104" stroke="#5b4630" strokeWidth="3" />
    <path d="M125 66q18 5 30 2-9 9-1 18-15 2-29-3Z" fill="#b8423c" />
    <ellipse cx="92" cy="174" rx="40" ry="7" fill="#0003" />
    <path d="M77 120h30l8 50H69Z" fill="#aab3c0" />
    <path d="M92 120h15l8 50H92Z" fill="#7f8a9b" />
    <circle cx="92" cy="106" r="13" fill="#c9d0d9" />
    <path d="M80 104h24v4H80Z" fill="#2b3346" />
    <path d="M92 93q4-9 13-9-4 7-6 13Z" fill="#b8423c" />
    <path d="M60 126h28v22q0 17-14 26-14-9-14-26Z" fill="#b8423c" stroke="#e8c66a" strokeWidth="2.5" />
    <path d="M74 132v34M64 146h20" stroke="#e8c66a" strokeWidth="3" />
  </g>,
  roadBuilding: <g>
    <path d="M52 208c22-36 74-42 58-74-10-20 0-34 10-42h7c-8 10-14 22-4 40 18 36-26 44-18 76Z" fill="#dcc192" />
    <path d="M83 208c8-26 40-38 32-66m0-32c-2-8 2-14 7-18" fill="none" stroke="#fff3d0" strokeWidth="2" strokeDasharray="6 6" opacity=".8" />
    <g transform="rotate(-24 52 160)"><rect x="30" y="154" width="44" height="11" rx="2" fill="#b8423c" /><path d="M30 159h44" stroke="#0002" /></g>
    <g transform="rotate(18 140 170)"><rect x="118" y="164" width="44" height="11" rx="2" fill="#3f6fa8" /><path d="M118 169h44" stroke="#0002" /></g>
    <path d="M148 118v34" stroke="#5b4630" strokeWidth="3" />
    <path d="M134 116h28l6 7-6 7h-28Z" fill="#efe0b6" stroke="#5b4630" strokeWidth="1.5" />
  </g>,
  yearOfPlenty: <g>
    <ellipse cx="96" cy="176" rx="64" ry="8" fill="#0003" />
    <path d="M42 90c-4 40 38 70 88 68l4-48c-38 8-72 6-86-20Z" fill="#c8913f" />
    <path d="M42 90c-6-6-2-14 5-12" fill="none" stroke="#c8913f" strokeWidth="5" strokeLinecap="round" />
    <path d="M66 112q-2 14-8 22m40-12q0 18-6 32" fill="none" stroke="#8d5d22" strokeWidth="3" strokeLinecap="round" />
    <path d="M48 104q22 38 80 46" fill="none" stroke="#e5b866" strokeWidth="2" opacity=".8" />
    <ellipse cx="132" cy="134" rx="9" ry="24" fill="#6e4618" transform="rotate(6 132 134)" />
    <g stroke="#b88a2c" strokeWidth="2"><path d="m136 124 18-34m-14 36 26-28m-30 30 6-38" /></g>
    <g fill="#e7c25e"><ellipse cx="154" cy="88" rx="3" ry="6" transform="rotate(28 154 88)" /><ellipse cx="167" cy="96" rx="3" ry="6" transform="rotate(48 167 96)" /><ellipse cx="143" cy="86" rx="3" ry="6" transform="rotate(8 143 86)" /></g>
    <g fill="#f1f2e6"><circle cx="146" cy="124" r="7" /><circle cx="155" cy="120" r="7" /><circle cx="157" cy="129" r="6" /></g>
    <rect x="138" y="136" width="20" height="11" rx="2" fill="#bd6e4d" transform="rotate(14 148 141)" />
    <path d="m146 156 8-12 10 6 2 12-12 4Z" fill="#8296aa" />
    <path d="M118 166h28l-2 7h-24Z" fill="#7a5530" /><circle cx="119" cy="169.5" r="3.5" fill="#a87d4c" />
    <path d="m70 56 3 8 8 3-8 3-3 8-3-8-8-3 8-3Zm96-6 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#fff6d6" />
  </g>,
  monopoly: <g>
    <ellipse cx="90" cy="178" rx="48" ry="7" fill="#0003" />
    <path d="M70 176h40l-6-10H76Z" fill="#c9a24a" />
    <path d="M88 82h4v86h-4Z" fill="#c9a24a" />
    <circle cx="90" cy="80" r="6" fill="#e8c66a" />
    <path d="M46 96 134 88" stroke="#e8c66a" strokeWidth="4" strokeLinecap="round" />
    <path d="m48 96-14 34m14-34 14 34m70-42-14 30m14-30 14 30" stroke="#e8c66a" strokeWidth="1.5" />
    <path d="M30 130h36q-4 14-18 14t-18-14Z" fill="#c9a24a" />
    <path d="M114 118h36q-4 14-18 14t-18-14Z" fill="#c9a24a" />
    <g stroke="#3b2a1d" strokeWidth="1"><rect x="36" y="112" width="12" height="18" rx="2" fill="#d6aa4b" /><rect x="44" y="110" width="12" height="20" rx="2" fill="#d6aa4b" /><rect x="52" y="112" width="12" height="18" rx="2" fill="#d6aa4b" /></g>
    <g fill="#f0cf6e" stroke="#9c7426"><ellipse cx="132" cy="116" rx="9" ry="3" /><ellipse cx="132" cy="112" rx="9" ry="3" /></g>
  </g>,
  victoryPoint: <g>
    <ellipse cx="90" cy="178" rx="58" ry="7" fill="#0003" />
    <path d="M44 176v-40l16-14 16 14v40Zm60 0v-40l16-14 16 14v40Z" fill="#efe2c2" />
    <path d="M60 176v-58l30-24 30 24v58Z" fill="#fbf0d6" />
    <path d="M60 118l30-24 30 24Z" fill="#b8423c" />
    <path d="M44 136l16-14 16 14Zm60 0 16-14 16 14Z" fill="#9b342f" />
    <path d="M82 176v-22q8-10 16 0v22Z" fill="#6a4b2a" />
    <path d="M68 134h6v14h-6Zm38 0h6v14h-6ZM87 116h6v10h-6Z" fill="#6a85a0" />
    <path d="m72 66 8 10 10-16 10 16 8-10-4 22H76Z" fill="#f3c955" stroke="#9c7426" strokeWidth="1.5" />
    <circle cx="90" cy="70" r="30" fill="#fff4c4" opacity=".25" />
  </g>,
};

/** 原創發展卡插畫；與資源牌共用構圖與尺寸，不讀取遊戲或手牌資料。 */
export const DevCardArt = memo(function DevCardArt({ card }: { card: string }) {
  const id = useId();
  const palette = PALETTES[card] ?? PALETTES.knight!;
  return (
    <svg className={`dev-card-art dev-card-art--${card}`} viewBox="0 0 180 208" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-sky`} x2="0" y2="1">
          <stop stopColor={palette.sky} />
          <stop offset="1" stopColor={palette.light} />
        </linearGradient>
        <linearGradient id={`${id}-shade`} x2="0" y2="1">
          <stop offset=".55" stopColor={palette.ground} stopOpacity="0" />
          <stop offset="1" stopColor={palette.ground} stopOpacity=".6" />
        </linearGradient>
      </defs>
      <path d="M0 0h180v208H0Z" fill={`url(#${id}-sky)`} />
      <circle cx="140" cy="40" r="18" fill={palette.light} opacity=".8" />
      <g fill="#fff8dd" opacity=".5">
        <path d="M-9 30q6-11 15-6 9-19 23-5 16-5 22 11Z" />
        <path d="M118 66q5-9 13-5 7-13 18-4 14-2 20 9Z" />
      </g>
      <path d="M-18 128 28 78l30 34 30-44 46 52 30-34 34 46v76H-18Z" fill={palette.far} />
      <path d="M-12 140q38-40 82-10 42-30 122 8v70H-12Z" fill={palette.near} />
      <path d="M-10 172q52-36 106-12 42-18 94-4v52H-10Z" fill={palette.ground} />
      {MOTIFS[card]}
      <path d="M0 0h180v208H0Z" fill={`url(#${id}-shade)`} />
      <g fill="none" stroke="#fff1c0" strokeWidth=".8" opacity=".45"><path d="M8 22V8h14m136 0h14v14M8 186v14h14m136 0h14v-14" /></g>
    </svg>
  );
});
