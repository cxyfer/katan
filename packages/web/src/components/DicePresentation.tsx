import { useEffect, useState } from 'react';
import { DICE_ROLL_DURATION_MS } from '../board/animation.ts';
import { useT } from '../i18n/context.tsx';
import { DieFace } from './DieFace.tsx';
import '../styles/dice-presentation.css';

/** 純呈現；點數只來自權威事件，翻滾圖案不參與遊戲狀態或命令。 */
export function DicePresentation({ dice, mandatory = false }: { dice: readonly [number, number]; mandatory?: boolean }) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setRevealed(true), DICE_ROLL_DURATION_MS);
    return () => globalThis.clearTimeout(timer);
  }, []);
  const result = t('play.diceResult', { first: dice[0], second: dice[1], total: dice[0] + dice[1] });

  return <div className="dice-presentation" data-testid="dice-focus" data-mandatory={mandatory ? 'true' : undefined} data-phase={revealed ? 'result' : 'rolling'}>
    <div className="dice-presentation__panel dice-focus__panel">
      <span className="dice-presentation__label">{t('play.dice')}</span>
      <div className="dice-presentation__pair" aria-hidden="true">
        {dice.map((value, index) => <DieFace key={index} value={revealed ? value : undefined}
          className={`dice-presentation__die${revealed ? '' : ' dice-presentation__die--rolling'}`} />)}
      </div>
      <strong aria-hidden="true">{revealed ? result : t('dice.rolling')}</strong>
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="dice-announcement">
        {revealed ? result : ''}
      </span>
    </div>
  </div>;
}
