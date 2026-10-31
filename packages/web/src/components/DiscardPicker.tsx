import { useEffect, useRef, useState } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatNumber } from '../i18n/format.ts';
import { ResourceGlyph } from './GameArt.tsx';
import { ResourceCardArt } from './ResourceCardArt.tsx';
import '../styles/discard-picker.css';

type Counts = Record<Resource, number>;
const NONE: Counts = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };

/**
 * 棄牌選擇器（docs/SPEC.md §4.4）：仿實體操作，從「手牌」點一張移到「棄牌區」，
 * 點棄牌區的牌放回手牌。五種資源一律列出（沒有的變暗），棄牌區的空格數就是
 * 需要棄掉的張數，因此進度與剩餘量不必讀數字也看得出來。
 */
export function DiscardPicker({ required, hand, onSubmit }: {
  required: number;
  hand: Partial<Record<Resource, number>> | undefined;
  onSubmit(resources: Resource[]): void;
}) {
  const t = useT();
  const locale = useLocale();
  const [picked, setPicked] = useState<Counts>(NONE);
  const rootRef = useRef<HTMLDivElement>(null);
  // 放回後焦點會隨按鈕消失；記下位置，重繪後移到同一格或該資源的手牌。
  const refocus = useRef<{ index: number; resource: Resource } | null>(null);

  const picks = RESOURCES.flatMap((resource) => Array.from({ length: picked[resource] }, () => resource));
  const selected = picks.length;
  const full = selected >= required;
  const handTotal = RESOURCES.reduce((sum, resource) => sum + (hand?.[resource] ?? 0), 0);
  const n = (value: number) => formatNumber(locale, value);

  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const root = rootRef.current;
    const slot = root?.querySelector<HTMLButtonElement>(`[data-testid="discard-slot-${Math.min(target.index, selected - 1)}"]`);
    (slot ?? root?.querySelector<HTMLButtonElement>(`[data-testid="discard-add-${target.resource}"]`))?.focus();
  }, [picked, selected]);

  const take = (resource: Resource) => {
    if (full || picked[resource] >= (hand?.[resource] ?? 0)) return;
    setPicked((current) => ({ ...current, [resource]: current[resource] + 1 }));
  };
  const giveBack = (resource: Resource, index: number) => {
    refocus.current = { index, resource };
    setPicked((current) => ({ ...current, [resource]: Math.max(0, current[resource] - 1) }));
  };

  return (
    <div className="discard" data-testid="discard-picker" data-full={full ? 'true' : undefined} ref={rootRef}>
      <p className="discard__hint">{t('play.pending.discardHint')}</p>

      <section className="discard__zone discard__zone--hand" aria-labelledby="discard-hand-label">
        <h3 className="discard__label" id="discard-hand-label">
          <span>{t('play.pending.discardHand')}</span>
          <span className="discard__meta" data-testid="discard-after">
            {t('play.pending.discardAfter', { count: n(handTotal - selected) })}
          </span>
        </h3>
        <ul className="discard__hand">
          {RESOURCES.map((resource) => {
            const have = hand?.[resource] ?? 0;
            const left = have - picked[resource];
            const unavailable = left <= 0 || full;
            const name = t(`resource.${resource}`);
            return (
              <li key={resource} className={`discard-card hand-card hand-card--${resource}`}
                data-resource={resource} data-empty={left <= 0 ? 'true' : undefined}>
                {/* aria-disabled 保留焦點：選滿或拿光時鍵盤使用者不會被踢回頁首。 */}
                <button type="button" className="hand-card__face discard-card__face" data-testid={`discard-add-${resource}`}
                  aria-disabled={unavailable} aria-describedby="discard-progress"
                  aria-label={t('play.pending.discardTake', { resource: name, left: n(left) })}
                  onClick={() => take(resource)}>
                  <span className="hand-card__art"><ResourceCardArt resource={resource} /></span>
                  <span className="hand-card__pip"><ResourceGlyph resource={resource} size={14} /></span>
                  <span className="hand-card__name">{name}</span>
                </button>
                <span className="discard-card__count" data-testid={`discard-left-${resource}`} aria-hidden="true">
                  {n(left)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="discard__zone discard__zone--pile" aria-labelledby="discard-pile-label">
        <h3 className="discard__label" id="discard-pile-label">
          <span>{t('play.pending.discardPile')}</span>
          <span className="discard__meta discard__progress" id="discard-progress" data-testid="discard-counts">
            {t('play.pending.discardProgress', { selected: n(selected), required: n(required) })}
          </span>
        </h3>
        <ol className="discard__pile">
          {Array.from({ length: required }, (_, index) => {
            const resource = picks[index];
            if (!resource) return <li key={`empty-${index}`} className="discard-slot" aria-hidden="true" />;
            return (
              <li key={`${resource}-${index}`} className={`discard-slot discard-slot--filled hand-card--${resource}`}>
                <button type="button" className="discard-slot__card" data-testid={`discard-slot-${index}`} data-resource={resource}
                  aria-label={t('play.pending.discardReturn', { resource: t(`resource.${resource}`) })}
                  onClick={() => giveBack(resource, index)}>
                  <ResourceCardArt resource={resource} />
                  <span className="discard-slot__pip"><ResourceGlyph resource={resource} size={12} /></span>
                  <span className="discard-slot__undo" aria-hidden="true">↩</span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="discard__actions">
        <button type="button" className="button button--ghost" data-testid="discard-reset" disabled={selected === 0}
          onClick={() => setPicked(NONE)}>
          {t('play.pending.discardClear')}
        </button>
        <button type="button" className="button button--primary" data-testid="discard-submit" disabled={selected !== required}
          onClick={() => onSubmit(picks)}>
          {selected === required
            ? t('play.pending.discardConfirm', { count: n(required) })
            : t('play.pending.discardMore', { count: n(required - selected) })}
        </button>
      </div>
    </div>
  );
}
