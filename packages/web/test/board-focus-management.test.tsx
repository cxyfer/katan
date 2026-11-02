import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { BoardTopology, PublicBoardView } from '@catan/rules';
import { buildGeometry } from '../src/board/geometry.ts';
import { SelectionPreview } from '../src/components/SelectionPreview.tsx';
import { TargetPicker } from '../src/components/TargetPicker.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState, type Selection } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeSnapshot, makeView } from '../src/test/fixtures.ts';

function previewController(selection: Selection): TableController {
  const state = initialTableState('en');
  state.game = makeSnapshot(makeView());
  state.selection = selection;
  const actions = {
    cancelSelection: vi.fn(),
    confirmSelection: vi.fn().mockResolvedValue(undefined),
  } as unknown as TableController['actions'];
  return { state, dispatch: vi.fn(), actions } as unknown as TableController;
}

const edgeSelection = (index: number): Selection => ({
  kind: 'edge', index, commandType: 'build.road', labelId: 'play.build.road',
});
function PickerHarness({
  board,
  topology,
  onCancel,
}: {
  board: PublicBoardView;
  topology: BoardTopology;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <LocaleProvider locale="en">
    <button type="button" onClick={() => setOpen(true)}>Open targets</button>
    {open && <TargetPicker geometry={buildGeometry('hex-r2')} board={board} topology={topology} kind="edge"
      targets={[5]} nameOf={() => 'Alex'} onChoose={vi.fn()} onCancel={() => { onCancel(); setOpen(false); }} />}
  </LocaleProvider>;
}

describe('board target focus management', () => {
  it('labels the non-modal picker and focuses its first option without trapping focus', async () => {
    const geometry = buildGeometry('hex-r2');
    const view = makeView();
    const onCancel = vi.fn();
    render(<PickerHarness board={view.board} topology={geometry.topology} onCancel={onCancel} />);
    const opener = screen.getByRole('button', { name: 'Open targets' });
    opener.focus();
    fireEvent.click(opener);

    const picker = screen.getByRole('dialog');
    const first = screen.getByTestId('picker-edge-5');
    expect(picker.getAttribute('aria-modal')).toBe('false');
    expect(picker.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab' });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it('restores the picker opener when the picker is unmounted while it owns focus', () => {
    const geometry = buildGeometry('hex-r2');
    const view = makeView();
    const renderPicker = (open: boolean) => <LocaleProvider locale="en">
      <button type="button">Open targets</button>
      {open && <TargetPicker geometry={geometry} board={view.board} topology={geometry.topology} kind="edge"
        targets={[5]} nameOf={() => 'Alex'} onChoose={vi.fn()} onCancel={vi.fn()} />}
    </LocaleProvider>;
    const rendered = render(renderPicker(false));
    const opener = screen.getByRole('button', { name: 'Open targets' });
    opener.focus();
    rendered.rerender(renderPicker(true));
    expect(document.activeElement).toBe(screen.getByTestId('picker-edge-5'));
    rendered.rerender(renderPicker(false));
    expect(document.activeElement).toBe(opener);
  });

  it('announces a selection, focuses its heading only on selection changes, and restores the target on cancel', async () => {
    const firstController = previewController(edgeSelection(5));
    const onCancel = vi.fn();
    const rendered = render(<button type="button" data-testid="target-edge-5">Target 5</button>);
    const target = screen.getByRole('button', { name: 'Target 5' });
    target.focus();

    rendered.rerender(
      <LocaleProvider locale="en">
        <button type="button" data-testid="target-edge-5">Target 5</button>
        <button type="button">Unrelated control</button>
        <SelectionPreview controller={firstController} onCancel={onCancel} />
      </LocaleProvider>,
    );

    const heading = await screen.findByTestId('preview-heading');
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('status').textContent).toContain('Path 5');

    const unrelated = screen.getByRole('button', { name: 'Unrelated control' });
    unrelated.focus();
    const secondController = previewController(edgeSelection(5));
    rendered.rerender(
      <LocaleProvider locale="en">
        <button type="button" data-testid="target-edge-5">Target 5</button>
        <button type="button">Unrelated control</button>
        <SelectionPreview controller={secondController} onCancel={onCancel} />
      </LocaleProvider>,
    );
    expect(document.activeElement).toBe(unrelated);

    const changedController = previewController(edgeSelection(9));
    rendered.rerender(
      <LocaleProvider locale="en">
        <button type="button" data-testid="target-edge-9">Target 9</button>
        <button type="button">Unrelated control</button>
        <SelectionPreview controller={changedController} onCancel={onCancel} />
      </LocaleProvider>,
    );
    expect(document.activeElement).toBe(screen.getByTestId('preview-heading'));
    expect(screen.getByRole('status').textContent).toContain('Path 9');

    fireEvent.keyDown(screen.getByTestId('preview-heading'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Target 9' })));
  });

  it('uses the board surface when the previous target is disconnected', async () => {
    const controller = previewController(edgeSelection(5));
    const rendered = render(<button type="button" data-testid="target-edge-5">Target 5</button>);
    screen.getByRole('button', { name: 'Target 5' }).focus();
    rendered.rerender(
      <LocaleProvider locale="en">
        <button type="button" data-testid="target-edge-5">Target 5</button>
        <SelectionPreview controller={controller} />
      </LocaleProvider>,
    );

    rendered.rerender(
      <LocaleProvider locale="en">
        <div tabIndex={0} data-testid="board-surface">Board</div>
        <SelectionPreview controller={controller} />
      </LocaleProvider>,
    );
    screen.getByTestId('preview-heading').focus();
    fireEvent.keyDown(screen.getByTestId('preview-heading'), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByTestId('board-surface'));
  });

  it('does not restore focus after confirming a selection', async () => {
    const controller = previewController(edgeSelection(5));
    const rendered = render(<button type="button" data-testid="target-edge-5">Target 5</button>);
    screen.getByRole('button', { name: 'Target 5' }).focus();
    rendered.rerender(
      <LocaleProvider locale="en">
        <button type="button" data-testid="target-edge-5">Target 5</button>
        <SelectionPreview controller={controller} />
      </LocaleProvider>,
    );
    const confirm = screen.getByTestId('confirm-selection');
    confirm.focus();
    fireEvent.click(confirm);
    expect(controller.actions.confirmSelection).toHaveBeenCalledTimes(1);

    const cleared = initialTableState('en');
    cleared.game = makeSnapshot(makeView());
    rendered.rerender(
      <LocaleProvider locale="en">
        <button type="button" data-testid="target-edge-5">Target 5</button>
        <SelectionPreview controller={{ ...controller, state: cleared }} />
      </LocaleProvider>,
    );
    expect(document.activeElement).not.toBe(rendered.container.querySelector('[data-testid="board-surface"]'));
    expect(screen.queryByTestId('selection-preview')).toBeNull();
  });

  it('restores the selected target across two select-and-cancel cycles', async () => {
    const onCancel = vi.fn();
    const first = previewController(edgeSelection(5));
    const rendered = render(<button type="button" data-testid="target-edge-5">Target 5</button>);
    screen.getByTestId('target-edge-5').focus();
    rendered.rerender(<LocaleProvider locale="en">
      <button type="button" data-testid="target-edge-5">Target 5</button>
      <SelectionPreview controller={first} onCancel={onCancel} />
    </LocaleProvider>);
    fireEvent.click(screen.getByTestId('cancel-selection'));
    expect(document.activeElement).toBe(screen.getByTestId('target-edge-5'));

    const second = previewController(edgeSelection(9));
    rendered.rerender(<LocaleProvider locale="en">
      <button type="button" data-testid="target-edge-9">Target 9</button>
      <SelectionPreview controller={second} onCancel={onCancel} />
    </LocaleProvider>);
    expect(document.activeElement).toBe(screen.getByTestId('preview-heading'));
    fireEvent.keyDown(screen.getByTestId('preview-heading'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(screen.getByTestId('target-edge-9'));
  });

  it('resets cancel suppression for a new selection and restores focus when it is invalidated', async () => {
    const onCancel = vi.fn();
    const first = previewController(edgeSelection(5));
    const rendered = render(<button type="button" data-testid="target-edge-5">Target 5</button>);
    screen.getByTestId('target-edge-5').focus();
    rendered.rerender(<LocaleProvider locale="en">
      <button type="button" data-testid="target-edge-5">Target 5</button>
      <SelectionPreview controller={first} onCancel={onCancel} />
    </LocaleProvider>);
    fireEvent.keyDown(screen.getByTestId('preview-heading'), { key: 'Escape' });
    rendered.rerender(<LocaleProvider locale="en">
      <button type="button" data-testid="target-edge-5">Target 5</button>
      <SelectionPreview controller={{ ...first, state: initialTableState('en') }} onCancel={onCancel} />
    </LocaleProvider>);

    const second = previewController(edgeSelection(9));
    rendered.rerender(<LocaleProvider locale="en">
      <button type="button" data-testid="target-edge-9">Target 9</button>
      <SelectionPreview controller={second} onCancel={onCancel} />
    </LocaleProvider>);
    screen.getByTestId('preview-heading').focus();
    rendered.rerender(<LocaleProvider locale="en">
      <button type="button" data-testid="target-edge-9">Target 9</button>
      <SelectionPreview controller={{ ...second, state: initialTableState('en') }} onCancel={onCancel} />
    </LocaleProvider>);
    expect(document.activeElement).toBe(screen.getByTestId('target-edge-9'));
  });
});

describe('target picker dismissal', () => {
  const firePointerDown = (element: Element) => fireEvent(element, new Event('pointerdown', { bubbles: true }));

  function renderPicker(onCancel: () => void) {
    const geometry = buildGeometry('hex-r2');
    const view = makeView();
    return render(<LocaleProvider locale="en">
      <div data-testid="outside">outside</div>
      <button type="button" data-testid="open-target-picker" data-target-picker-ignore="">toggle</button>
      <TargetPicker geometry={geometry} board={view.board} topology={geometry.topology} kind="edge"
        targets={[5]} nameOf={() => 'Alex'} onChoose={vi.fn()} onCancel={onCancel} />
    </LocaleProvider>);
  }

  it('closes on an outside pointerdown but not inside the popover or on the ignored toggle', () => {
    const onCancel = vi.fn();
    renderPicker(onCancel);
    firePointerDown(screen.getByTestId('picker-edge-5'));
    firePointerDown(screen.getByRole('dialog'));
    firePointerDown(screen.getByTestId('open-target-picker'));
    expect(onCancel).not.toHaveBeenCalled();
    firePointerDown(screen.getByTestId('outside'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape even when focus is outside the popover', () => {
    const onCancel = vi.fn();
    renderPicker(onCancel);
    screen.getByTestId('outside').focus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button', () => {
    const onCancel = vi.fn();
    renderPicker(onCancel);
    fireEvent.click(screen.getByTestId('target-picker-close'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('swallows the click that follows an outside press on a board target', () => {
    const onCancel = vi.fn();
    const onTargetClick = vi.fn();
    const geometry = buildGeometry('hex-r2');
    const view = makeView();
    render(<LocaleProvider locale="en">
      <button type="button" className="board-target" data-testid="board-target" onClick={onTargetClick}>t</button>
      <TargetPicker geometry={geometry} board={view.board} topology={geometry.topology} kind="edge"
        targets={[5]} nameOf={() => 'Alex'} onChoose={vi.fn()} onCancel={onCancel} />
    </LocaleProvider>);
    const target = screen.getByTestId('board-target');
    firePointerDown(target);
    fireEvent.click(target);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onTargetClick).not.toHaveBeenCalled();
    // 只吞一次：之後的刻意點擊照常作用。
    fireEvent.click(target);
    expect(onTargetClick).toHaveBeenCalledTimes(1);
  });
});
