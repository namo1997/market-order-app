import { StrictMode, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import DeferredView from './DeferredView.jsx';
const App = lazy(() => import('./App.jsx'));
const LocalDemo = lazy(() => import('./LocalDemo.jsx'));
import './styles.css';

const isLocalDemo = new URLSearchParams(window.location.search).get('local-demo') === '1';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DeferredView label={isLocalDemo ? 'หน้าทดลอง' : 'ระบบรับเงิน'}>{isLocalDemo ? <LocalDemo /> : <App />}</DeferredView>
  </StrictMode>
);

if (!isLocalDemo && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
