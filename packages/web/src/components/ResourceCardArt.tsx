import { memo, useId } from 'react';
import type { Resource } from '@catan/rules';
import { TerrainIllustration } from './GameArt.tsx';

const PALETTES: Record<Resource, { sky: string; light: string; far: string; near: string; ground: string }> = {
  lumber: { sky: '#6eaaa5', light: '#e7dba6', far: '#5c8474', near: '#3f6850', ground: '#244e3a' },
  brick: { sky: '#b5bcc0', light: '#f5d8ac', far: '#bc8c72', near: '#a76749', ground: '#744c39' },
  wool: { sky: '#8dbabd', light: '#f8e8b8', far: '#89a477', near: '#729658', ground: '#476e45' },
  grain: { sky: '#a3b9b5', light: '#fff0c0', far: '#b4a16b', near: '#d3ad55', ground: '#9d7b36' },
  ore: { sky: '#789da8', light: '#e3e4cd', far: '#8b9b9a', near: '#667b82', ground: '#405967' },
};

/** 原創卡面風景；與棋盤共用地形畫法，不讀取遊戲或手牌資料。每張手牌各有一份，以 memo 避免重繪。 */
export const ResourceCardArt = memo(function ResourceCardArt({ resource }: { resource: Resource }) {
  const id = useId();
  const palette = PALETTES[resource];
  return (
    <svg className={`resource-card-art resource-card-art--${resource}`} viewBox="0 0 180 208" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-sky`} x2="0" y2="1">
          <stop stopColor={palette.sky} />
          <stop offset="1" stopColor={palette.light} />
        </linearGradient>
        <linearGradient id={`${id}-shade`} x2="0" y2="1">
          <stop offset=".5" stopColor={palette.ground} stopOpacity="0" />
          <stop offset="1" stopColor={palette.ground} stopOpacity=".7" />
        </linearGradient>
        <clipPath id={`${id}-frame`}><rect width="180" height="208" rx="5" /></clipPath>
      </defs>
      <g clipPath={`url(#${id}-frame)`}>
        <path d="M0 0h180v208H0Z" fill={`url(#${id}-sky)`} />
        <circle cx={resource === 'ore' ? 135 : 43} cy="46" r="20" fill={palette.light} opacity=".85" />
        <g fill="#fff8dd" opacity=".55">
          <path d="M-9 34q6-11 15-6 9-19 23-5 16-5 22 11Z" />
          <path d="M99 63q5-10 14-6 8-16 20-5 16-3 23 11Z" />
          <path d="M135 24q9-14 21-6 10-8 24 6Z" />
        </g>
        <path d="M-18 121 25 64l31 38 28-46 48 59 32-40 39 51v51H-18Z" fill={palette.far} />
        <path d="m25 64 8 29-9-5-9 9Zm59-8 15 25-14-7-11 9Zm80 19 11 20-12-4-8 6Z" fill={palette.light} opacity=".65" />
        <path d="M-12 128q36-48 80-8 41-39 125 9v83H-12Z" fill={palette.near} />
        <path d="M-10 167q51-55 108-15 40-26 93-7v63H-10Z" fill={palette.ground} />
        {resource === 'grain' && <g fill="none" stroke="#f3d38a" strokeWidth="3" opacity=".75"><path d="M-14 149q96-46 214 11M-14 170q106-45 214 9M-14 193q106-44 214 4" /><path d="m117 129-47 79m65-78-25 78" strokeWidth="2" /></g>}
        {resource === 'wool' && <g fill="none" stroke="#b5c887" strokeWidth="2" opacity=".7"><path d="M-8 150q55-21 98-3m4 35q49-26 99-8M7 189l3-8 3 7m135-39 3-9 3 7m-128 3 3-7 3 6" /></g>}
        {resource === 'brick' && <g fill="none" stroke="#e4b489" strokeWidth="2" opacity=".6"><path d="M-6 143q36-29 75-14m41 31q36-21 78-8M-6 186q43-24 84-11m36 27 56-16" /></g>}
        {resource === 'ore' && <g fill="#c0c7bd" opacity=".5"><path d="m10 173 8-13 12 13-11 7Zm119-20 8-10 10 8-9 9Zm15 39 13-15 16 17-16 7Z" /></g>}
        {resource === 'lumber' && <g opacity=".55"><TerrainIllustration terrain="lumber" x={28} y={122} scale={.58} /><TerrainIllustration terrain="lumber" x={153} y={135} scale={.72} /></g>}
        <TerrainIllustration terrain={resource} x={90} y={159} scale={resource === 'ore' ? 1.18 : 1.06} />
        <path d="M0 0h180v208H0Z" fill={`url(#${id}-shade)`} />
        <g fill="none" stroke="#fff1c0" strokeWidth=".8" opacity=".45"><path d="M8 22V8h14m136 0h14v14M8 186v14h14m136 0h14v-14" /></g>
      </g>
    </svg>
  );
});
