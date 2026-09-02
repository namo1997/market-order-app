import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import LocalDemo from './LocalDemo.jsx';
import './styles.css';

const isLocalDemo = new URLSearchParams(window.location.search).get('local-demo') === '1';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isLocalDemo ? <LocalDemo /> : <App />}
  </StrictMode>
);

if (!isLocalDemo && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
