console.log('Main.jsx: File 1 loaded');
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { CartProvider } from './contexts/CartContext'
import { GeneralPurchaseProvider } from './contexts/GeneralPurchaseContext'
import ErrorBoundary from './components/common/ErrorBoundary'
import { reloadForNewVersion } from './utils/chunk-reload'
import './index.css'
import App from './App.jsx'

console.log('Main.jsx: Starting application mount');

// หลัง deploy ไฟล์ chunk เก่าถูกลบ แท็บที่เปิดค้างไว้จะโหลดหน้าใหม่ไม่ได้ -> reload เพื่อรับเวอร์ชันล่าสุด
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewVersion()) {
    event.preventDefault();
  }
});

try {
  const root = createRoot(document.getElementById('root'));
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <CartProvider>
              <GeneralPurchaseProvider>
                <App />
              </GeneralPurchaseProvider>
            </CartProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
  console.log('Main.jsx: Application mount called');
} catch (error) {
  console.error('Main.jsx: Fatal error during mount', error);
}
