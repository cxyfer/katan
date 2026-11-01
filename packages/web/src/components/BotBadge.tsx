import type { BotLevel } from '@catan/protocol';
import { useT } from '../i18n/context.tsx';
import { botBadgeLabel } from '../state/bots.ts';
import { GameIcon } from './GameArt.tsx';
import '../styles/bot-seats.css';

/** 電腦座位徽章；`short` 只顯示「電腦」，完整難度放在 title 供滑鼠查看。 */
export function BotBadge({ level, short = false, testId }: {
  level?: BotLevel | null; short?: boolean; testId?: string;
}) {
  const t = useT();
  const label = botBadgeLabel(t, level);
  return (
    <span className="badge bot-badge" data-testid={testId} title={`${label} — ${t('lobby.bots.seatNote')}`}>
      <GameIcon name="bot" size={short ? 10 : 14} />
      {short ? t('bot.badgeShort') : label}
    </span>
  );
}
