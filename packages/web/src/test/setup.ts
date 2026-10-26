/**
 * Vitest setup (jsdom).
 *
 * `@testing-library/jest-dom` is intentionally not used: assertions are plain
 * DOM checks. The only thing this file provides is the small set of browser
 * APIs jsdom does not implement, wired to real viewport state so a test can
 * simply set `window.innerWidth` to exercise the mobile layout.
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

type MediaListener = (event: { matches: boolean; media: string }) => void;

interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  onchange: MediaListener | null;
  addEventListener(type: string, listener: MediaListener): void;
  removeEventListener(type: string, listener: MediaListener): void;
  addListener(listener: MediaListener): void;
  removeListener(listener: MediaListener): void;
  dispatchEvent(): boolean;
}

function evaluate(query: string): boolean {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return globalThis.innerWidth <= Number(max[1]);
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return globalThis.innerWidth >= Number(min[1]);
  return false;
}

if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = ((query: string): FakeMediaQueryList => {
    const list: FakeMediaQueryList = {
      matches: evaluate(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
    return list;
  }) as unknown as typeof globalThis.matchMedia;
}

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  } as unknown as typeof globalThis.ResizeObserver;
}

if (typeof globalThis.scrollTo !== 'function') {
  globalThis.scrollTo = (() => undefined) as unknown as typeof globalThis.scrollTo;
}
