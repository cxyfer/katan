import { useId, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { COSTS, getTopology } from '@catan/rules';
import { useLocale, useT } from '../i18n/context.tsx';
import { formatResourceMap } from '../i18n/format.ts';
import { describeTarget } from '../board/targets.ts';
import { nameOf } from '../state/table.ts';
import type { TableController } from '../state/useTable.ts';
import { EP_HARBOR_COST, EP_SHIP_COST } from '../board/explorersPirates.ts';

const COST_BY_COMMAND: Record<string, Partial<Record<string, number>> | null> = {
  'build.road': COSTS.road,
  'build.settlement': COSTS.settlement,
  'build.city': COSTS.city,
  'setup.placeBuilding': null,
  'setup.placeRoad': null,
  'pending.moveRobber': null,
  'dev.playKnight': null,
  'build.ship': { lumber: 1, wool: 1 },
  'setup.placeShip': null,
  'ship.move': null,
  'ep.buildHarbor': EP_HARBOR_COST,
  'ep.buildShip': EP_SHIP_COST,
};

/**
 * `browse → select → preview → submitting → confirmed/rejected` (docs/SPEC.md
 * §8.2). The preview names the target, the cost and the consequence, and can
 * always be cancelled before submission without spending anything.
 */
export function SelectionPreview({
  controller,
  onCancel,
  fallbackFocusRef,
}: {
  controller: TableController;
  onCancel?: () => void;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const locale = useLocale();
  const { state, actions } = controller;
  const view = state.game?.view;
  const selection = state.selection;
  const nameResolver = useMemo(() => nameOf(state), [state]);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const focusInsideRef = useRef(false);
  const suppressRestoreRef = useRef(false);
  const activeSelectionKeyRef = useRef<string | null>(null);
  const restorePreviousFocusRef = useRef<() => void>(() => undefined);
  const hasSelection = !!view && !!selection.kind && selection.index !== null;
  const selectedAnchorRef = useRef({ kind: selection.kind, index: selection.index });
  if (hasSelection) selectedAnchorRef.current = { kind: selection.kind, index: selection.index };
  const selectionKey = hasSelection
    ? `${selection.kind}:${selection.index}:${selection.commandType ?? ''}`
    : null;
  const option = useMemo(() => {
    if (!view || !selection.kind || selection.index === null) return null;
    return describeTarget(
      { locale, topology: getTopology(view.board.topologyId), board: view.board, nameOf: nameResolver },
      selection.kind,
      selection.index,
    );
  }, [locale, nameResolver, selection.index, selection.kind, view]);

  const cost = selection.commandType ? COST_BY_COMMAND[selection.commandType] ?? null : null;

  const restorePreviousFocus = () => {
    const { kind, index } = selectedAnchorRef.current;
    const selectedTarget = document.querySelector<HTMLElement>(
      `button[data-testid="target-${kind}-${index}"]`,
    );
    const previous = previousFocusRef.current;
    const fallback = fallbackFocusRef?.current ?? document.querySelector<HTMLElement>('[data-testid="board-surface"]');
    if (selectedTarget?.isConnected) selectedTarget.focus();
    else if (previous?.isConnected) previous.focus();
    else fallback?.focus();
  };
  restorePreviousFocusRef.current = restorePreviousFocus;

  useLayoutEffect(() => {
    if (!hasSelection) {
      activeSelectionKeyRef.current = null;
      return;
    }
    const isNewSelection = activeSelectionKeyRef.current !== selectionKey;
    activeSelectionKeyRef.current = selectionKey;
    if (isNewSelection) suppressRestoreRef.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement
      && (active.matches('button[data-testid^="target-"]') || active.closest('[data-testid="board-surface"]'))) {
      previousFocusRef.current = active;
    }
    focusInsideRef.current = true;
    headingRef.current?.focus();
  }, [hasSelection, selectionKey]);

  useLayoutEffect(() => {
    if (!hasSelection) return;
    return () => {
      if (focusInsideRef.current && !suppressRestoreRef.current) restorePreviousFocusRef.current();
      focusInsideRef.current = false;
    };
  }, [hasSelection]);

  if (!view || !selection.kind || selection.index === null || !option) return null;
  const costText = cost ? formatResourceMap(locale, cost) : t('app.none');
  const targetText = [option.label, option.detail].join(String.fromCodePoint(0x00b7));

  const cancel = () => {
    suppressRestoreRef.current = true;
    if (onCancel) onCancel();
    else actions.cancelSelection();
    restorePreviousFocus();
  };

  const confirm = async () => {
    suppressRestoreRef.current = true;
    try {
      await actions.confirmSelection();
    } finally {
      if (previewRef.current?.isConnected) suppressRestoreRef.current = false;
    }
  };

  return (
    <section
      ref={previewRef}
      className="preview"
      aria-labelledby={headingId}
      data-testid="selection-preview"
      onFocusCapture={() => { focusInsideRef.current = true; }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusInsideRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
    >
      <h3 ref={headingRef} id={headingId} tabIndex={-1} data-testid="preview-heading">{t('play.selectionTitle')}</h3>
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="preview-announcement">
        {t('play.selectionTarget', { target: targetText })}; {t('play.selectionCost', { cost: costText })}
      </p>
      <p data-testid="preview-target">
        {t('play.selectionTarget', { target: targetText })}
      </p>
      <p>{t('play.selectionCost', { cost: costText })}</p>
      <p className="muted">
        {t('play.selectionConsequence', {
          consequence: t(selection.labelId ?? 'play.confirmPlacement'),
        })}
      </p>
      <div className="preview__actions">
        <button
          type="button"
          className="button button--primary"
          data-testid="confirm-selection"
          onClick={() => void confirm()}
        >
          {t('play.confirmPlacement')}
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="cancel-selection"
          onClick={cancel}
        >
          {t('play.cancelSelection')}
        </button>
      </div>
    </section>
  );
}
