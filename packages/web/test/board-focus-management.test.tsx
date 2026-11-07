import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { BoardTopology, PublicBoardView } from '@catan/rules';
import { buildGeometry } from '../src/board/geometry.ts';
import { SelectionPreview } from '../src/components/SelectionPreview.tsx';
import { TargetPicker } from '../src/components/TargetPicker.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';
import { initialTableState, type Selection } from '../src/state/table.ts';
import type { TableController } from '../src/state/useTable.ts';
import { makeSnapshot, makeView, placeLabel } from '../src/test/fixtures.ts';

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
    expect(screen.getByRole('status').textContent).toContain(placeLabel('edge', 5));

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
    expect(screen.getByRole('status').textContent).toContain(placeLabel('edge', 9));

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

  afterEach(() => vi.useRealTimers());

  function targetDismissal() {
    const onTargetClick = vi.fn();
    const geometry = buildGeometry('hex-r2');
    const view = makeView();
    function Harness() {
      const [open, setOpen] = useState(true);
      return <LocaleProvider locale="en">
        <button type="button" className="board-target" data-testid="board-target" onClick={onTargetClick}>target</button>
        {open && <TargetPicker geometry={geometry} board={view.board} topology={geometry.topology} kind="edge"
          targets={[5]} nameOf={() => 'Alex'} onChoose={vi.fn()} onCancel={() => setOpen(false)} />}
      </LocaleProvider>;
    }
    render(<Harness />);
    return { target: screen.getByTestId('board-target'), onTargetClick };
  }

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

  it('swallows a touch click delivered in a later task after pointerup and picker unmount', async () => {
    const { target, onTargetClick } = targetDismissal();
    firePointerDown(target);
    expect(screen.queryByTestId('target-picker')).toBeNull();
    fireEvent(target, new Event('pointerup', { bubbles: true }));
    // 觸控 click 可在另一個 task 派發，不能在 pointerup 後以零延遲計時器移除攔截。
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(target);
    expect(onTargetClick).not.toHaveBeenCalled();
    fireEvent.click(target);
    expect(onTargetClick).toHaveBeenCalledTimes(1);
  });

  it('lets the next pointer gesture through when the dismissed gesture never clicks', () => {
    const { target, onTargetClick } = targetDismissal();
    firePointerDown(target);
    firePointerDown(target);
    fireEvent.click(target);
    expect(onTargetClick).toHaveBeenCalledTimes(1);
  });

  it('swallows the release click after a press lasting more than one second', () => {
    vi.useFakeTimers();
    const { target, onTargetClick } = targetDismissal();
    firePointerDown(target);
    vi.advanceTimersByTime(1200);
    fireEvent(target, new Event('pointerup', { bubbles: true }));
    fireEvent.click(target);
    expect(onTargetClick).not.toHaveBeenCalled();
    fireEvent.click(target);
    expect(onTargetClick).toHaveBeenCalledTimes(1);
  });

  it.each(['pointerup', 'pointercancel'])('expires suppression one second after %s without a click', (type) => {
    vi.useFakeTimers();
    const { target, onTargetClick } = targetDismissal();
    firePointerDown(target);
    vi.advanceTimersByTime(1200);
    fireEvent(target, new Event(type, { bubbles: true }));
    vi.advanceTimersByTime(1001);
    fireEvent.click(target);
    expect(onTargetClick).toHaveBeenCalledTimes(1);
  });

  it.each(['Enter', ' '])('allows a keyboard %s click after a drag that produced no pointer click', (key) => {
    const { target, onTargetClick } = targetDismissal();
    firePointerDown(target);
    fireEvent(target, new Event('pointerup', { bubbles: true }));
    fireEvent.keyDown(target, { key });
    fireEvent.click(target, { detail: 0 });
    expect(onTargetClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ...['Shift', 'Control', 'Alt', 'Meta'].map((key) => ({ key, repeat: false })),
    ...['Shift', 'Enter', ' ', 'a'].map((key) => ({ key, repeat: true })),
  ])('keeps the dismiss click guarded for key=$key repeat=$repeat', ({ key, repeat }) => {
    const { target, onTargetClick } = targetDismissal();
    firePointerDown(target);
    fireEvent.keyDown(target, { key, repeat });
    fireEvent(target, new Event('pointerup', { bubbles: true }));
    fireEvent.click(target);
    expect(onTargetClick).not.toHaveBeenCalled();
    fireEvent.click(target);
    expect(onTargetClick).toHaveBeenCalledTimes(1);
  });

  it('expires click suppression even when pointerup never arrives', () => {
    vi.useFakeTimers();
    const { target, onTargetClick } = targetDismissal();
    firePointerDown(target);
    vi.advanceTimersByTime(10001);
    fireEvent.click(target);
    expect(onTargetClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    <input aria-label="chat" />,
    <textarea aria-label="chat" />,
    <select aria-label="chat"><option>option</option></select>,
    <div contentEditable suppressContentEditableWarning><span>editable child</span></div>,
    <div role="dialog" aria-modal="true"><button type="button">modal action</button></div>,
    <dialog open><button type="button">dialog action</button></dialog>,
  ])('leaves Escape from an editable field or another dialog to its owner (%#)', (field) => {
    const onCancel = vi.fn();
    const onEscape = vi.fn();
    renderPicker(onCancel);
    const other = render(<div onKeyDown={onEscape}>{field}</div>);
    const target = other.container.querySelector('input, textarea, select, span, button')!;
    fireEvent.keyDown(target, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onEscape.mock.calls[0]![0].defaultPrevented).toBe(false);
    expect(screen.getByTestId('target-picker')).toBeTruthy();
  });
});

describe('target picker positioning', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  type FakeObserver = { callback: () => void; observed: Element[]; disconnect: Mock };
  let observers: FakeObserver[] = [];
  const originalObserver = globalThis.ResizeObserver;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.ResizeObserver = originalObserver;
    observers = [];
  });

  const picker = () => screen.getByTestId('target-picker');

  /** jsdom 沒有版面：以假的 offsetParent、尺寸與矩形模擬 640x400 棋盤與高度可變的工具列。 */
  function setup(toolbar: number, hud?: DOMRect) {
    const toolbarHeight = { value: toolbar };
    const boardSize = { width: 640, height: 400 };
    const pickerSize = { width: 200, height: 120 };
    const forPicker = (element: HTMLElement) => element.classList.contains('target-picker');
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return forPicker(this) ? this.parentElement : null;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return forPicker(this) ? pickerSize.width : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return forPicker(this) ? pickerSize.height : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset['testid'] === 'board-parent') return rect(0, 0, boardSize.width, boardSize.height);
      if (this.dataset['testid'] === 'toolbar') return rect(4, 6, 140, toolbarHeight.value);
      if (this.dataset['testid'] === 'hud' && hud) return hud;
      return rect(0, 0, 0, 0);
    });
    globalThis.ResizeObserver = class {
      readonly entry: FakeObserver = { callback: () => undefined, observed: [], disconnect: vi.fn() };
      constructor(callback: () => void) {
        this.entry.callback = callback;
        observers.push(this.entry);
      }
      observe(element: Element) { this.entry.observed.push(element); }
      unobserve() { /* no-op */ }
      disconnect() { this.entry.disconnect(); }
    } as unknown as typeof ResizeObserver;
    const geometry = buildGeometry('hex-r2');
    const view = makeView();
    const ui = (anchor?: { x: number; y: number }) => <LocaleProvider locale="en">
      <div data-board-stage="">
        <div data-testid="board-parent">
          <div className="board__toolbar--side" data-testid="toolbar">toolbar</div>
          <TargetPicker geometry={geometry} board={view.board} topology={geometry.topology} kind="edge"
            targets={[5]} nameOf={() => 'Alex'} onChoose={vi.fn()} {...(anchor ? { anchor } : {})} />
        </div>
        {/* 棋盤下緣的資源列（#103）：位置由 hud 矩形決定。 */}
        <div className="game__dock"><div className="resource-tally" data-testid="hud" /></div>
      </div>
    </LocaleProvider>;
    const rendered = render(ui());
    return { toolbarHeight, boardSize, pickerSize, ui, ...rendered };
  }

  it('keeps the popover below the actual toolbar bottom instead of a fixed height', () => {
    const { ui, rerender } = setup(40);
    // 錨點靠上：未夾限時 top = 10 + 14 = 24，會落在工具列內。
    rerender(ui({ x: 100, y: 10 }));
    expect(picker().style.top).toBe('50px'); // 6 + 40 + 4
  });

  it('clears a toolbar that wrapped to several rows', () => {
    const { ui, rerender } = setup(140);
    rerender(ui({ x: 100, y: 10 }));
    expect(picker().style.top).toBe('150px'); // 6 + 140 + 4
  });

  it('repositions when the parent or toolbar resizes and disconnects on unmount', () => {
    const { ui, rerender, toolbarHeight, boardSize, unmount } = setup(40);
    rerender(ui({ x: 100, y: 10 }));
    expect(picker().style.top).toBe('50px');
    const observer = observers[observers.length - 1]!;
    expect(observer.observed.map((element) => (element as HTMLElement).dataset['testid'])).toEqual(['board-parent', 'toolbar', 'target-picker']);
    // 視窗變窄，工具列換成三列。
    toolbarHeight.value = 140;
    boardSize.width = 360;
    observer.callback();
    expect(picker().style.top).toBe('150px');
    expect(Number.parseFloat(picker().style.left)).toBeLessThanOrEqual(360 - 200 - 8);
    expect(observer.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('also reacts to window resize and stops listening after unmount', () => {
    const { ui, rerender, toolbarHeight, unmount } = setup(40);
    rerender(ui({ x: 100, y: 10 }));
    toolbarHeight.value = 100;
    fireEvent(window, new Event('resize'));
    expect(picker().style.top).toBe('110px');
    const removed = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removed).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('returns below the toolbar when the anchor goes away and keeps observing', () => {
    const { ui, rerender } = setup(40);
    rerender(ui({ x: 100, y: 200 }));
    const observer = observers[observers.length - 1]!;
    rerender(ui());
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(picker().style.top).toBe('50px');
    expect(picker().style.left).toBe('8px');
    expect(observers[observers.length - 1]!.observed).toContain(picker());
  });

  it('positions an unanchored picker below a wrapped toolbar on mount and resize', () => {
    const { toolbarHeight, boardSize } = setup(140);
    expect(picker().style.top).toBe('150px');
    expect(picker().style.left).toBe('8px');
    toolbarHeight.value = 180;
    boardSize.width = 360;
    observers[observers.length - 1]!.callback();
    expect(picker().style.top).toBe('190px');
    toolbarHeight.value = 100;
    fireEvent(window, new Event('resize'));
    expect(picker().style.top).toBe('110px');
  });

  it('retains its observer for equal anchor coordinates and repositions when the picker grows', () => {
    const { ui, rerender, pickerSize } = setup(40);
    rerender(ui({ x: 300, y: 200 }));
    const observer = observers[observers.length - 1]!;
    const count = observers.length;
    rerender(ui({ x: 300, y: 200 }));
    expect(observers).toHaveLength(count);
    expect(observer.disconnect).not.toHaveBeenCalled();
    expect(observer.observed).toContain(picker());
    expect(picker().style.left).toBe('314px');
    pickerSize.width = 400;
    observer.callback();
    expect(picker().style.left).toBe('8px');
  });

  it('limits its height to the room between the toolbar and the board bottom', () => {
    setup(40);
    // 400 - 8（下緣邊距）- 50（工具列下緣 6 + 40 + 4）
    expect(picker().style.getPropertyValue('--target-picker-room')).toBe('342px');
  });

  it('starts at the top edge when it sits beside the toolbar instead of under it', () => {
    const { ui, rerender } = setup(40);
    // 工具列只到 x = 144；popover 從 314 開始，不必讓到工具列下方。
    rerender(ui({ x: 300, y: 10 }));
    expect(picker().style.left).toBe('314px');
    expect(picker().style.top).toBe('24px');
    expect(picker().style.getPropertyValue('--target-picker-room')).toBe('384px');
  });

  it('flips above the click instead of running under the resource strip', () => {
    const { ui, rerender } = setup(40, rect(100, 330, 300, 40));
    // 下方需要 214 + 120 = 334，超過資源列上緣 330 - 8；上方 200 - 14 - 120 = 66 放得下。
    rerender(ui({ x: 100, y: 200 }));
    expect(picker().style.top).toBe('66px');
  });

  it('stays beside the click and covers the strip when neither side fits', () => {
    const { ui, rerender, pickerSize } = setup(40, rect(100, 330, 300, 40));
    pickerSize.height = 200;
    // 下方 134 + 200 碰到資源列、上方不足工具列下緣：仍放在點擊處下方，疊在資源列上。
    rerender(ui({ x: 100, y: 120 }));
    expect(picker().style.top).toBe('134px');
  });

  it('ignores a strip that does not share its column', () => {
    const { ui, rerender } = setup(40, rect(400, 330, 200, 40));
    rerender(ui({ x: 100, y: 200 }));
    expect(picker().style.top).toBe('214px');
  });

  it('marks a clipped list so the overflow cue shows on the hidden side', () => {
    setup(40);
    const list = picker().querySelector('.target-picker__list')!;
    let scrollTop = 0;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 300 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 100 });
    Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => scrollTop });
    fireEvent.scroll(list);
    expect(picker().hasAttribute('data-more-below')).toBe(true);
    expect(picker().hasAttribute('data-more-above')).toBe(false);
    scrollTop = 200;
    fireEvent.scroll(list);
    expect(picker().hasAttribute('data-more-below')).toBe(false);
    expect(picker().hasAttribute('data-more-above')).toBe(true);
  });

  it('positions without an anchor and tolerates a missing ResizeObserver', () => {
    const { ui, rerender } = setup(40);
    rerender(ui());
    expect(picker().style.top).toBe('50px');
    expect(picker().style.left).toBe('8px');
    // @ts-expect-error 模擬沒有 ResizeObserver 的環境
    delete globalThis.ResizeObserver;
    rerender(ui({ x: 100, y: 10 }));
    expect(picker().style.top).toBe('50px');
  });
});
