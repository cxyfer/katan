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
 * 點棄牌區的牌放回手牌。五種資源一律列出（沒有的變暗）；棄牌區依資源疊成最多
 * 五疊，上方分段進度條的格數就是要棄的張數，因此要棄十幾張時高度也不會增加。
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
  // 一疊放回最後一張時按鈕會消失；重繪後把焦點移到下一疊，沒有就回到該資源的手牌。
  const refocus = useRef<Resource | null>(null);

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
    if (picked[target] > 0) return;
    const stacks = RESOURCES.filter((resource) => picked[resource] > 0);
    const next = stacks.find((resource) => RESOURCES.indexOf(resource) > RESOURCES.indexOf(target)) ?? stacks.at(-1);
    const selector = next ? `[data-testid="discard-return-${next}"]` : `[data-testid="discard-add-${target}"]`;
    root?.querySelector<HTMLButtonElement>(selector)?.focus();
  }, [picked]);

  const take = (resource: Resource) => {
    if (full || picked[resource] >= (hand?.[resource] ?? 0)) return;
    setPicked((current) => ({ ...current, [resource]: current[resource] + 1 }));
  };
  const giveBack = (resource: Resource) => {
    refocus.current = resource;
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
        <div className="discard__meter" aria-hidden="true">
          {Array.from({ length: required }, (_, index) => {
            const resource = picks[index];
            return <span key={index} className={`discard__cell${resource ? ` discard__cell--filled hand-card--${resource}` : ''}`} />;
          })}
        </div>
        <ul className="discard__pile">
          {selected === 0 && <li className="discard__pile-empty">{t('play.pending.discardPileEmpty')}</li>}
          {RESOURCES.filter((resource) => picked[resource] > 0).map((resource) => (
            <li key={resource} className={`discard-stack hand-card--${resource}`} data-resource={resource}
              data-depth={Math.min(picked[resource], 3)}>
              <button type="button" className="discard-stack__card" data-testid={`discard-return-${resource}`}
                aria-label={t('play.pending.discardReturn', { resource: t(`resource.${resource}`), count: n(picked[resource]) })}
                onClick={() => giveBack(resource)}>
                <ResourceCardArt resource={resource} />
                <span className="discard-stack__pip"><ResourceGlyph resource={resource} size={12} /></span>
                <span className="discard-stack__undo" aria-hidden="true">↩</span>
              </button>
              <span className="discard-stack__count" data-testid={`discard-picked-${resource}`} aria-hidden="true">
                ×{n(picked[resource])}
              </span>
            </li>
          ))}
        </ul>
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
