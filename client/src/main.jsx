console.log('Main.jsx: File 1 loaded');
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { CartProvider } from './contexts/CartContext'
import ErrorBoundary from './components/common/ErrorBoundary'
import './index.css'
import App from './App.jsx'

console.log('Main.jsx: Starting application mount');

try {
  const root = createRoot(document.getElementById('root'));
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <CartProvider>
              <App />
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
