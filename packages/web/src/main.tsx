import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createApiClient } from './api/client.ts';
import './styles.css';

const container = document.getElementById('root');
const preview = new URLSearchParams(globalThis.location.search).get('preview') === 'island';
const IslandPreview = preview ? lazy(() => import('./components/IslandPreview.tsx')) : null;
if (container) {
  createRoot(container).render(
    <StrictMode>
      {IslandPreview ? <Suspense fallback={<p role="status">正在載入島嶼展示…</p>}><IslandPreview /></Suspense>
        : <App services={{ api: createApiClient() }} />}
    </StrictMode>,
  );
}
