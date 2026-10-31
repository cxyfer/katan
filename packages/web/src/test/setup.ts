/**
 * Vitest setup (jsdom).
 *
 * `@testing-library/jest-dom` is intentionally not used: assertions are plain
 * DOM checks. The only thing this file provides is the small set of browser
 * APIs jsdom does not implement, wired to real viewport state so a test can
 * simply set `window.innerWidth` to exercise the mobile layout.
 */

import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  // jsdom has no GPU: ordinary app tests intentionally exercise SVG. Renderer
  // lifecycle tests override this query explicitly to verify the 3D default.
  history.replaceState(null, '', '/?renderer=svg');
});

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

/** 只支援以 `and` 串接的寬高條件；沒有寬高條件的查詢一律不成立。 */
function evaluate(query: string): boolean {
  const features = [...query.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)];
  if (features.length === 0) return false;
  return features.every(([, bound, axis, value]) => {
    const size = axis === 'width' ? globalThis.innerWidth : globalThis.innerHeight;
    return bound === 'min' ? size >= Number(value) : size <= Number(value);
  });
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
