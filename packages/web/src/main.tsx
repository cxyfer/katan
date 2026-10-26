import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createApiClient } from './api/client.ts';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App services={{ api: createApiClient() }} />
    </StrictMode>,
  );
}
