import { useEffect, useRef, useState } from 'react';
import { RESOURCES, type Resource } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { bankSupply, formatBankSupply, formatNumber } from '../i18n/format.ts';
import { ResourceGlyph } from './GameArt.tsx';
import { ResourceCardArt } from './ResourceCardArt.tsx';
import '../styles/discard-picker.css';

type Counts = Record<Resource, number>;
const NONE: Counts = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };

/**
 * 壟斷與豐收之年的資源選擇器：沿用棄牌選擇器的版面（上方五種資源、下方選取區），
 * 讓「選牌 → 確認」的操作一致。壟斷只能選一種，點另一種會直接替換；
 * 豐收之年依銀行存量選滿 `required` 張，可重複同一種。
 */
export function DevCardChoicePicker({ card, required, bank, busy, onSubmit, onCancel }: {
  card: 'monopoly' | 'yearOfPlenty';
  required: number;
  /** 豐收之年才需要：每種資源的投影存量（`min(存量, 2)`，2 代表「2 張以上」，#137）。 */
  bank?: Partial<Record<Resource, number>>;
  /** 指令送出中：鎖住選擇與按鈕。 */
  busy: boolean;
  onSubmit(resources: Resource[]): void;
  /** 尚未打出時可取消；伺服器已進入領取步驟時不提供。 */
  onCancel?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const n = (value: number) => formatNumber(locale, value);
  const monopoly = card === 'monopoly';
  const [picked, setPicked] = useState<Counts>(NONE);
  const rootRef = useRef<HTMLDivElement>(null);

  const picks = RESOURCES.flatMap((resource) => Array.from({ length: picked[resource] }, () => resource));
  const selected = picks.length;
  const full = selected >= required;
  const left = (resource: Resource) => (bank?.[resource] ?? 0) - picked[resource];

  // 從手牌拖出或按下「使用」後，焦點直接移到第一種可選的資源。
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('.discard-card__face:not([aria-disabled="true"])')?.focus();
  }, []);

  const take = (resource: Resource) => {
    if (busy) return;
    if (monopoly) {
      setPicked({ ...NONE, [resource]: 1 });
      return;
    }
    if (full || left(resource) <= 0) return;
    setPicked((current) => ({ ...current, [resource]: current[resource] + 1 }));
  };
  const giveBack = (resource: Resource) => {
    if (busy) return;
    setPicked((current) => ({ ...current, [resource]: Math.max(0, current[resource] - 1) }));
  };

  return (
    <div className="discard devcard-choice" data-testid="devcard-choice" data-card={card} data-full={full ? 'true' : undefined}
      ref={rootRef} onKeyDown={(event) => {
        if (event.key === 'Escape' && onCancel && !busy) { event.preventDefault(); onCancel(); }
      }}>
      <p className="discard__hint">{t(`devCard.choice.hint.${card}`)}</p>

      <section className="discard__zone discard__zone--hand" aria-labelledby="choice-source-label">
        <h3 className="discard__label" id="choice-source-label">
          <span>{t(monopoly ? 'devCard.choice.resources' : 'devCard.choice.bank')}</span>
        </h3>
        <ul className="discard__hand">
          {RESOURCES.map((resource) => {
            const remaining = monopoly ? 1 : left(resource);
            const unavailable = busy || remaining <= 0 || (!monopoly && full);
            const name = t(`resource.${resource}`);
            // 投影只到上限：上限值是「至少」，扣掉已選的牌後仍是「至少」。
            const supply = bankSupply(bank?.[resource] ?? 0, picked[resource]);
            return (
              <li key={resource} className={`discard-card hand-card hand-card--${resource}`}
                data-resource={resource} data-empty={remaining <= 0 ? 'true' : undefined}
                data-chosen={monopoly && picked[resource] > 0 ? 'true' : undefined}>
                <button type="button" className="hand-card__face discard-card__face" data-testid={`choice-add-${resource}`}
                  aria-disabled={unavailable} aria-describedby="choice-progress"
                  aria-pressed={monopoly ? picked[resource] > 0 : undefined}
                  aria-label={monopoly ? name : t(supply.atLeast ? 'devCard.choice.takeAtLeast' : 'devCard.choice.take', { resource: name, left: n(supply.count) })}
                  onClick={() => take(resource)}>
                  <span className="hand-card__art"><ResourceCardArt resource={resource} /></span>
                  <span className="hand-card__pip"><ResourceGlyph resource={resource} size={14} /></span>
                  <span className="hand-card__name">{name}</span>
                </button>
                {!monopoly && <span className="discard-card__count" data-testid={`choice-bank-${resource}`} aria-hidden="true">
                  {formatBankSupply(locale, bank?.[resource] ?? 0, picked[resource])}
                </span>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="discard__zone discard__zone--pile" aria-labelledby="choice-pile-label">
        <h3 className="discard__label" id="choice-pile-label">
          <span>{t(monopoly ? 'devCard.choice.target' : 'devCard.choice.gain')}</span>
          <span className="discard__meta discard__progress" id="choice-progress" data-testid="choice-progress">
            {t('play.pending.discardProgress', { selected: n(selected), required: n(required) })}
          </span>
        </h3>
        {!monopoly && <div className="discard__meter" aria-hidden="true">
          {Array.from({ length: required }, (_, index) => {
            const resource = picks[index];
            return <span key={index} className={`discard__cell${resource ? ` discard__cell--filled hand-card--${resource}` : ''}`} />;
          })}
        </div>}
        <ul className="discard__pile">
          {selected === 0 && <li className="discard__pile-empty">{t('devCard.choice.empty')}</li>}
          {RESOURCES.filter((resource) => picked[resource] > 0).map((resource) => (
            <li key={resource} className={`discard-stack hand-card--${resource}`} data-resource={resource}
              data-depth={Math.min(picked[resource], 3)}>
              <button type="button" className="discard-stack__card" data-testid={`choice-return-${resource}`}
                aria-label={t('devCard.choice.return', { resource: t(`resource.${resource}`), count: n(picked[resource]) })}
                onClick={() => giveBack(resource)}>
                <ResourceCardArt resource={resource} />
                <span className="discard-stack__pip"><ResourceGlyph resource={resource} size={12} /></span>
                <span className="discard-stack__undo" aria-hidden="true">↩</span>
              </button>
              <span className="discard-stack__count" aria-hidden="true">×{n(picked[resource])}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="discard__actions">
        {onCancel
          ? <button type="button" className="button button--ghost" data-testid="choice-cancel" disabled={busy} onClick={onCancel}>
            {t('devCard.choice.cancel')}
          </button>
          : <button type="button" className="button button--ghost" data-testid="choice-reset" disabled={busy || selected === 0}
            onClick={() => setPicked(NONE)}>
            {t('play.pending.discardClear')}
          </button>}
        <button type="button" className="button button--primary" data-testid="choice-submit" disabled={busy || required <= 0 || selected !== required}
          onClick={() => onSubmit(picks)}>
          {busy
            ? t('devCard.choice.busy')
            : selected === required
              ? (monopoly
                ? t('devCard.choice.confirmMonopoly', { resource: t(`resource.${picks[0]!}`) })
                : t('devCard.choice.confirmYearOfPlenty', { resources: picks.map((resource) => t(`resource.${resource}`)) }))
              : t('play.pending.discardMore', { count: n(required - selected) })}
        </button>
      </div>
    </div>
  );
}
