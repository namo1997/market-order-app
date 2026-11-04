import '../src/index.css';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { GeneralPurchaseProvider, useGeneralPurchase } from '../src/contexts/GeneralPurchaseContext';
import { CartProvider, useCart } from '../src/contexts/CartContext';
import { Input } from '../src/components/common/Input';
import { ProductList } from '../src/pages/user/ProductList';
import { ReceiveOrders } from '../src/pages/user/ReceiveOrders';
import { Cart } from '../src/pages/user/Cart';

import { StockCheck } from '../src/pages/user/StockCheck';
import { StockVariance } from '../src/pages/inventory/StockVariance';
import { InventoryDashboard } from '../src/pages/inventory/InventoryDashboard';
import { GeneralPurchaseHub } from '../src/pages/general-purchase/Hub';
import { GeneralPurchaseAwaiting } from '../src/pages/general-purchase/Awaiting';
import { GeneralPurchaseReceive } from '../src/pages/general-purchase/Receive';
import { GeneralPurchaseReview } from '../src/pages/general-purchase/Review';
import { GeneralPurchasePO } from '../src/pages/general-purchase/PO';
import { AdminSettings } from '../src/pages/admin/AdminSettings';
import { PlannedReportPage } from '../src/pages/admin/masters/PlannedReportPage';
import { FollowupBell } from '../src/pages/receiving/FollowupBell';
import { FunctionSelect } from '../src/pages/user/FunctionSelect';
import { AppLauncher } from '../src/pages/apps/AppLauncher';

export const Probe = () => {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const cart = useCart();
  const general = useGeneralPurchase();
  useEffect(() => { window.__audit = { auth, cart, general, navigate }; }, [auth, cart, general, navigate]);
  const mode = {
    '/general-purchase/hub': 'gp-hub', '/general-purchase/awaiting': 'gp-awaiting',
    '/general-purchase/receive': 'gp-receive', '/general-purchase/review': 'gp-review',
    '/general-purchase/po': 'gp-po', '/admin/settings/reports/operations': 'planned-report'
  }[location.pathname] || new URLSearchParams(location.search).get('mode');
  return <>
    <pre id="audit-state" hidden>{JSON.stringify({ user: auth.user, loading: auth.loading, items: cart.cartItems, date: cart.orderDate, canOperate: general.canOperate })}</pre>
    {!mode && <Input data-testid="bounded-number" type="number" min="1" max="10" defaultValue="0" />}
    {!auth.loading && mode === 'products' && <ProductList />}
    {!auth.loading && mode === 'receive' && <ReceiveOrders />}
    {!auth.loading && mode === 'cart' && <Cart />}
    {!auth.loading && mode === 'stock-check' && <StockCheck />}
    {!auth.loading && mode === 'stock-variance' && <StockVariance />}
    {!auth.loading && mode === 'inventory-dashboard' && <InventoryDashboard />}
    {!auth.loading && mode === 'gp-hub' && <GeneralPurchaseHub />}
    {!auth.loading && mode === 'gp-awaiting' && <GeneralPurchaseAwaiting />}
    {!auth.loading && mode === 'gp-receive' && <GeneralPurchaseReceive />}
    {!auth.loading && mode === 'gp-review' && <GeneralPurchaseReview />}
    {!auth.loading && mode === 'gp-po' && <GeneralPurchasePO />}
    {!auth.loading && mode === 'settings' && <AdminSettings />}
    {!auth.loading && mode === 'planned-report' && <PlannedReportPage />}
    {!auth.loading && mode === 'followup' && <FollowupBell />}
    {!auth.loading && mode === 'function-select' && <FunctionSelect />}
    {!auth.loading && mode === 'launcher' && <AppLauncher />}

  </>;
};
createRoot(document.getElementById('root')).render(
  <StrictMode><BrowserRouter><AuthProvider><CartProvider><GeneralPurchaseProvider><Probe /></GeneralPurchaseProvider></CartProvider></AuthProvider></BrowserRouter></StrictMode>
);
