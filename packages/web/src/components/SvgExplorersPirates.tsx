/**
 * Explorers & Pirates pieces for the SVG board: the fog over unexplored hexes
 * (with a lifting animation when a hex is explored), harbour settlements,
 * ships with their cargo, crews, lairs, fish shoals, spice farms, the Council
 * of Catan and the pirate ship. Original hand-written shapes; colour is never
 * the only cue (ships carry the seat's dash pattern, cargo has distinct
 * silhouettes and every piece has a <title>).
 */

import type { GameView } from '@catan/rules';
import type { BoardEffectGroup } from '../board/animation.ts';
import type { BoardGeometry } from '../board/geometry.ts';
import { epView, shipSlots, type EpView } from '../board/explorersPirates.ts';
import { playerColorHex, seatDash } from '../board/terrain.ts';
import { useT } from '../i18n/context.tsx';
import type { EpCargo } from '@catan/rules';
import { shade } from './SvgBoardArt.tsx';
import { edgeAngle, edgeMidpoint, PirateShip, ShipPiece } from './SvgSeafarers.tsx';

const CARGO_FILL: Record<EpCargo, string> = { settler: '#f4ead2', crew: '#3a3532', fish: '#7cc6e8', spice: '#c9762e' };

/** One cargo piece drawn at the origin (about 12 units wide). */
export function CargoGlyph({ piece, color }: { piece: EpCargo; color?: string }) {
  const stroke = '#20180f';
  switch (piece) {
    case 'settler':
      // a settler: a small figure with a bundle
      return <g>
        <circle cy="-5" r="3.2" fill={color ?? CARGO_FILL.settler} stroke={stroke} strokeWidth="1.2" />
        <path d="M-4.5 6l1.5-8h6l1.5 8Z" fill={color ?? CARGO_FILL.settler} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />
      </g>;
    case 'crew':
      // a crew: a figure in a tricorn hat
      return <g>
        <circle cy="-4" r="3" fill={color ?? '#e9dcc0'} stroke={stroke} strokeWidth="1.2" />
        <path d="M-5-6.5h10l-2-3h-6Z" fill={CARGO_FILL.crew} stroke={stroke} strokeWidth="1" />
        <path d="M-4 6l1-7h6l1 7Z" fill={CARGO_FILL.crew} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />
      </g>;
    case 'fish':
      return <g>
        <path d="M-7 0q5-6 10 0q-5 6-10 0Z M3 0l4-4v8Z" fill={CARGO_FILL.fish} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="-3.5" cy="-0.8" r="0.9" fill={stroke} />
      </g>;
    case 'spice':
      return <g>
        <path d="M-5 6q-2-6 1-9l-1-2h10l-1 2q3 3 1 9Z" fill={CARGO_FILL.spice} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M-3-3h6" stroke={stroke} strokeWidth="1.2" />
      </g>;
  }
}

/** A cargo piece for HTML (prompt, panels): an inline SVG icon with an optional label. */
export function CargoChip({ piece, labelled = false }: { piece: EpCargo; labelled?: boolean }) {
  const t = useT();
  const name = t(`ep.piece.${piece}`);
  return <span className="ep-cargo" data-cargo={piece} title={name}>
    <svg viewBox="-8 -10 16 17" width="16" height="17" aria-hidden="true"><CargoGlyph piece={piece} /></svg>
    {labelled ? <span>{name}</span> : <span className="visually-hidden">{name}</span>}
  </span>;
}

/** A soft bank of cloud over an unexplored hex; `region` picks the badge (parrot or goose). */
function FogCloud({ hex, region, className, testId }: {
  hex: BoardGeometry['hexes'][number]; region: 'parrot' | 'goose'; className?: string; testId?: string;
}) {
  const { cx, cy } = hex;
  return <g className={className} data-testid={testId} data-region={region} pointerEvents="none">
    <polygon points={hex.points} fill="#d8dee0" fillOpacity=".92" stroke="#f6f8f7" strokeWidth="2" strokeLinejoin="round" />
    <path d={`M${cx - 52} ${cy + 12}q-4-22 18-24q8-22 32-14q22-10 32 10q22 2 18 26Z`} fill="#f3f5f4" opacity=".9" />
    <path d={`M${cx - 30} ${cy - 22}q2-14 18-12q10-12 24 0`} fill="none" stroke="#bfc8cb" strokeWidth="3" strokeLinecap="round" />
    <path d={`M${cx - 44} ${cy + 28}h88`} stroke="#c7cfd1" strokeWidth="3" strokeLinecap="round" strokeDasharray="10 9" />
    <RegionBadge x={cx} y={cy + 4} region={region} />
  </g>;
}

/** Parrot (red-green, curved beak) or goose (white, long neck): silhouettes differ, not just colour. */
function RegionBadge({ x, y, region }: { x: number; y: number; region: 'parrot' | 'goose' }) {
  return <g transform={`translate(${x} ${y})`}>
    <circle r="15" fill={region === 'parrot' ? '#2f7d4a' : '#5a6d7a'} stroke="#f6f8f7" strokeWidth="2.4" />
    {region === 'parrot'
      ? <g>
          <path d="M-6 9q-2-12 4-16q6-3 9 2q1 3-2 4l-3 1q2 6-2 9Z" fill="#d9442f" stroke="#20180f" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M7-5q3 1 2 5l-3-2Z" fill="#f2c95a" stroke="#20180f" strokeWidth="1" />
          <circle cx="2" cy="-4" r="1.2" fill="#20180f" />
        </g>
      : <g>
          <path d="M-9 8q0-8 8-8q2-6 0-10q3-3 6 0l3 1-3 1q1 6-1 9q7 1 6 7Z" fill="#f6f4ee" stroke="#20180f" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="3" cy="-8" r="1" fill="#20180f" />
        </g>}
  </g>;
}

function colorOf(view: GameView, playerId: string): string {
  return playerColorHex(view.players.find((player) => player.id === playerId)?.color ?? 'white');
}

/** Crews standing on a site, side by side in arrival order. */
function CrewRow({ crews, x, y, view }: { crews: readonly string[]; x: number; y: number; view: GameView }) {
  return <g transform={`translate(${x - ((crews.length - 1) * 13) / 2} ${y})`}>
    {crews.map((player, index) => <g key={index} transform={`translate(${index * 13} 0)`}><CargoGlyph piece="crew" color={colorOf(view, player)} /></g>)}
  </g>;
}

function Sites({ geometry, view, slot, nameResolver }: { geometry: BoardGeometry; view: GameView; slot: EpView; nameResolver: (id: string) => string }) {
  const t = useT();
  return <>
    {slot.sites.map((site) => {
      const hex = geometry.hexes[site.hex];
      if (!hex) return null;
      const { cx, cy } = hex;
      if (site.kind === 'council') {
        return <g key={`site-${site.hex}`} data-testid={`ep-council-${site.hex}`}>
          <path d={`M${cx - 30} ${cy + 18}h60v-26l-30-18-30 18Z`} fill="#e8d6a8" stroke="#5a3f1c" strokeWidth="2.4" strokeLinejoin="round" />
          <path d={`M${cx - 20} ${cy + 18}v-20M${cx - 7} ${cy + 18}v-20M${cx + 7} ${cy + 18}v-20M${cx + 20} ${cy + 18}v-20`} stroke="#8a6a35" strokeWidth="3" />
          <path d={`M${cx} ${cy - 26}v-14l12 4-12 4`} fill="#b83a2e" stroke="#5a3f1c" strokeWidth="1.4" />
          <title>{t('ep.site.council')}</title>
        </g>;
      }
      if (site.kind === 'lair') {
        return <g key={`site-${site.hex}`} data-testid={`ep-lair-${site.hex}`} data-captured={site.captured ? 'true' : 'false'}>
          {!site.captured && <g transform={`translate(${cx + 30} ${cy - 30})`}>
            <path d="M0 22v-30" stroke="#20180f" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M0-8h20l-4 7 4 7H0Z" fill="#2a2523" stroke="#0b0908" strokeWidth="1.2" />
            <circle cx="9" cy="-2" r="3" fill="#efe6cf" />
          </g>}
          {site.captured && <path d={`M${cx + 22} ${cy - 24}l8 8 14-18`} fill="none" stroke="#2f7d4a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />}
          <CrewRow crews={site.crews} x={cx} y={cy - 26} view={view} />
          <title>{`${t('ep.site.lair')} · ${site.captured ? t('ep.site.captured') : t('ep.site.crews', { count: site.crews.length })}`}</title>
        </g>;
      }
      if (site.kind === 'shoal') {
        return <g key={`site-${site.hex}`} data-testid={`ep-shoal-${site.hex}`} data-fish={site.fish ? 'true' : 'false'}>
          <path d={`M${cx - 44} ${cy - 4}q11-8 22 0t22 0t22 0t22 0`} fill="none" stroke="#e8fbf6" strokeWidth="2.4" opacity=".8" />
          <circle cx={cx} cy={cy + 30} r="15" fill="#fff8e4" stroke="#5a3f1c" strokeWidth="2" />
          <text x={cx} y={cy + 35.5} textAnchor="middle" fontSize="15" fontWeight="700" fill="#20180f">{site.number}</text>
          {site.fish && <g transform={`translate(${cx} ${cy - 22}) scale(1.6)`} data-testid={`ep-haul-${site.hex}`}><CargoGlyph piece="fish" /></g>}
          <title>{`${t('ep.site.shoal', { number: site.number })}${site.fish ? ` · ${t('ep.site.haul')}` : ''}`}</title>
        </g>;
      }
      return <g key={`site-${site.hex}`} data-testid={`ep-spice-${site.hex}`}>
        <g transform={`translate(${cx} ${cy - 4}) scale(2.2)`}><CargoGlyph piece="spice" /></g>
        <text x={cx} y={cy + 34} textAnchor="middle" fontSize="12" fontWeight="700" fill="#20180f">{t(`ep.ability.${site.ability}Short`)}</text>
        <CrewRow crews={site.crews} x={cx} y={cy - 34} view={view} />
        <title>{`${t('ep.site.spice')} · ${t(`ep.ability.${site.ability}`)}${site.crews.length ? ` · ${site.crews.map(nameResolver).join(', ')}` : ''}`}</title>
      </g>;
    })}
  </>;
}

/**
 * Everything E&P adds on top of the base SVG layers. Renders nothing for
 * other games. Ships sharing an edge sit side by side across it.
 */
export function SvgExplorersPiratesLayer({ geometry, view, active, nameResolver }: {
  geometry: BoardGeometry; view: GameView; active: BoardEffectGroup | null; nameResolver: (id: string) => string;
}) {
  const t = useT();
  const slot = epView(view);
  if (!slot) return null;
  const slots = shipSlots(slot);
  const revealed = (active?.events ?? []).filter((event) => event.type === 'ep.explored' && typeof event.params.hex === 'number');
  return <g data-testid="ep-layer">
    <Sites geometry={geometry} view={view} slot={slot} nameResolver={nameResolver} />
    {slot.fog.map((entry) => {
      const hex = geometry.hexes[entry.hex];
      return hex ? <g key={`fog-${entry.hex}`}><FogCloud hex={hex} region={entry.region} testId={`ep-fog-${entry.hex}`} className="ep-fog" />
        <title>{t('ep.fog.title', { region: t(`ep.region.${entry.region}`) })}</title></g> : null;
    })}
    {revealed.map((event) => {
      const hex = geometry.hexes[event.params.hex as number];
      const region = event.params.region === 'goose' ? 'goose' : 'parrot';
      return hex ? <FogCloud key={`${active!.id}-${event.seq}`} hex={hex} region={region} className="ep-fog ep-fog--lift" /> : null;
    })}
    {slot.harbors.map((harbor) => {
      const vertex = geometry.vertices[harbor.vertex];
      if (!vertex) return null;
      const color = colorOf(view, harbor.player);
      return <g key={`harbor-${harbor.vertex}`} data-testid={`ep-harbor-${harbor.vertex}`} transform={`translate(${vertex.x} ${vertex.y})`}>
        <circle cx="0" cy="-30" r="9" fill="#fff8e4" stroke={shade(color, -0.5)} strokeWidth="2" />
        <path d="M0-36v11M-4-26q4 4 8 0M-3-34h6" fill="none" stroke="#20180f" strokeWidth="1.8" strokeLinecap="round" />
        {harbor.cargo.map((piece, index) => <g key={index} transform={`translate(${18 + index * 13} -18)`}><CargoGlyph piece={piece} color={piece === 'settler' || piece === 'crew' ? color : undefined} /></g>)}
        <title>{`${t('ep.piece.harbor')} · ${nameResolver(harbor.player)}${harbor.cargo.length ? ` · ${harbor.cargo.map((piece) => t(`ep.piece.${piece}`)).join(', ')}` : ''}`}</title>
      </g>;
    })}
    {slot.ships.map((ship) => {
      const edge = geometry.edges[ship.edge];
      if (!edge) return null;
      const player = view.players.find((candidate) => candidate.id === ship.player);
      const color = playerColorHex(player?.color ?? 'white');
      const angle = edgeAngle(edge);
      const mid = edgeMidpoint(edge);
      const place = slots.get(ship.id) ?? { slot: 0, of: 1 };
      const offset = place.of > 1 ? (place.slot === 0 ? -11 : 11) : 0;
      const rad = ((angle + 90) * Math.PI) / 180;
      const x = mid.x + Math.cos(rad) * offset;
      const y = mid.y + Math.sin(rad) * offset;
      return <g key={ship.id} data-testid={`ep-ship-${ship.id}`} data-edge={ship.edge} data-cargo={ship.cargo.join(',')} className="ep-ship-piece">
        <ShipPiece x={x} y={y} angle={angle} color={color} dash={seatDash(player?.seat ?? 0)} />
        <g transform={`translate(${x} ${y}) rotate(${angle})`}>
          {ship.cargo.map((piece, index) => <g key={index} transform={`translate(${(index - (ship.cargo.length - 1) / 2) * 15} -3)`}>
            <CargoGlyph piece={piece} color={piece === 'settler' || piece === 'crew' ? color : undefined} /></g>)}
        </g>
        <title>{`${t('ep.piece.ship')} · ${nameResolver(ship.player)}${ship.cargo.length ? ` · ${ship.cargo.map((piece) => t(`ep.piece.${piece}`)).join(', ')}` : ''}`}</title>
      </g>;
    })}
    {slot.pirate && geometry.hexes[slot.pirate.hex] && (() => {
      const hex = geometry.hexes[slot.pirate.hex]!;
      return <g data-testid="ep-pirate" data-hex={slot.pirate.hex}>
        <PirateShip x={hex.cx} y={hex.cy + 4} />
        <circle cx={hex.cx + 34} cy={hex.cy - 24} r="7" fill={colorOf(view, slot.pirate.owner)} stroke="#0b0908" strokeWidth="2" />
        <title>{t('ep.pirate.title', { name: nameResolver(slot.pirate.owner) })}</title>
      </g>;
    })()}
  </g>;
}
