import '../src/index.css';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { GeneralPurchaseProvider, useGeneralPurchase } from '../src/contexts/GeneralPurchaseContext';
import { CartProvider, useCart } from '../src/contexts/CartContext';
import { Input } from '../src/components/common/Input';
import { ProductList } from '../src/pages/user/ProductList';
import { ReceiveOrders } from '../src/pages/user/ReceiveOrders';
import { Cart } from '../src/pages/user/Cart';

export const Probe = () => {
  const auth = useAuth();
  const cart = useCart();
  const general = useGeneralPurchase();
  useEffect(() => { window.__audit = { auth, cart, general }; }, [auth, cart, general]);
  const mode = new URLSearchParams(window.location.search).get('mode');
  return <>
    <pre id="audit-state" hidden>{JSON.stringify({ user: auth.user, loading: auth.loading, items: cart.cartItems, date: cart.orderDate, canOperate: general.canOperate })}</pre>
    <Input data-testid="bounded-number" type="number" min="1" max="10" defaultValue="0" />
    {!auth.loading && mode === 'products' && <ProductList />}
    {!auth.loading && mode === 'receive' && <ReceiveOrders />}
    {!auth.loading && mode === 'cart' && <Cart />}
  </>;
};
createRoot(document.getElementById('root')).render(
  <StrictMode><BrowserRouter><AuthProvider><CartProvider><GeneralPurchaseProvider><Probe /></GeneralPurchaseProvider></CartProvider></AuthProvider></BrowserRouter></StrictMode>
);
