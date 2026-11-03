import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { createApiClient } from './api/client.ts';
import { createAudioEngine } from './audio/engine.ts';

const container = document.getElementById('root');
const preview = new URLSearchParams(globalThis.location.search).get('preview');
// `?preview=archipelago` opens the same model display on the synthetic
// scenario board (sea frame, several islands, gold) used by the platform tests.
const IslandPreview = preview === 'island' || preview === 'archipelago' ? lazy(() => import('./components/IslandPreview.tsx')) : null;
const SoundPreview = preview === 'sounds' ? lazy(() => import('./components/SoundPreview.tsx')) : null;
if (container) {
  createRoot(container).render(
    <StrictMode>
      {IslandPreview ? <Suspense fallback={<p role="status">正在載入島嶼展示…</p>}><IslandPreview initialTopology={preview === 'archipelago' ? 'sample-archipelago' : 'hex-r2'} /></Suspense>
        : SoundPreview ? <Suspense fallback={<p role="status">正在載入音效展示…</p>}><SoundPreview /></Suspense>
          : <App services={{ api: createApiClient(), audio: createAudioEngine() }} />}
    </StrictMode>,
  );
}
