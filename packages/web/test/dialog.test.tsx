import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog } from '../src/components/Dialog.tsx';
import { LocaleProvider } from '../src/i18n/context.tsx';

/** 模擬牌桌浮動工具列：有 transform/containment 且裁切 overflow。 */
function ClippedHost() {
  const [open, setOpen] = useState(false);
  return (
    <LocaleProvider locale="zh-Hant">
      <div
        data-testid="clipping-host"
        style={{ overflow: 'hidden', transform: 'translateX(0px)', containerType: 'inline-size' }}
      >
        <button type="button" data-testid="open-dialog" onClick={() => setOpen(true)}>open</button>
        {open && (
          <Dialog title="確認交換" onClose={() => setOpen(false)} testId="clipped-dialog">
            <p>terms</p>
          </Dialog>
        )}
      </div>
    </LocaleProvider>
  );
}

describe('Dialog', () => {
  it('portals the modal outside clipping and containing-block ancestors', () => {
    render(<ClippedHost />);
    const opener = screen.getByTestId('open-dialog');
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByTestId('clipped-dialog');
    // 留在原樹狀位置時，fixed backdrop 會以 transform 祖先為 containing block
    // 並被 overflow 裁切，導致對話框跑到面板下方且無法點擊。
    expect(screen.getByTestId('clipping-host').contains(dialog)).toBe(false);
    expect(dialog.closest('[data-testid="clipping-host"]')).toBeNull();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('clipped-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
