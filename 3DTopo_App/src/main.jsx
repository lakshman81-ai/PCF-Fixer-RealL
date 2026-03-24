import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Standard Vite Mount
const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Export for Integration
export function mount3DTopo(containerId) {
  const container = document.getElementById(containerId);
  if (container) {
    createRoot(container).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log(`[3DTopo] Mounted successfully to ${containerId}`);
  } else {
    console.error(`[3DTopo] Container ${containerId} not found.`);
  }
}

// Optional: Auto-mount if script is loaded via module
window.mount3DTopo = mount3DTopo;
