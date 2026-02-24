import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { Loading } from './components/common/Loading';

const lazyNamed = (importer, exportName) =>
  lazy(() => importer().then((module) => ({ default: module[exportName] })));

const Login = lazyNamed(() => import('./pages/auth/Login'), 'Login');
const FunctionSelect = lazyNamed(() => import('./pages/user/FunctionSelect'), 'FunctionSelect');
const ProductList = lazyNamed(() => import('./pages/user/ProductList'), 'ProductList');
const ReceiveOrders = lazyNamed(() => import('./pages/user/ReceiveOrders'), 'ReceiveOrders');
const Cart = lazyNamed(() => import('./pages/user/Cart'), 'Cart');
const StockCheck = lazyNamed(() => import('./pages/user/StockCheck'), 'StockCheck');
const UserOrderHistory = lazyNamed(() => import('./pages/user/OrderHistory'), 'OrderHistory');
const WithdrawStock = lazyNamed(() => import('./pages/user/WithdrawStock'), 'WithdrawStock');
const OrdersToday = lazyNamed(() => import('./pages/admin/OrdersToday'), 'OrdersToday');
const AdminOrderHistory = lazyNamed(() => import('./pages/admin/OrderHistory'), 'OrderHistory');
const PurchaseWalk = lazyNamed(() => import('./pages/admin/PurchaseWalk'), 'PurchaseWalk');
const AdminSettings = lazyNamed(() => import('./pages/admin/AdminSettings'), 'AdminSettings');
const AdminReports = lazyNamed(() => import('./pages/admin/AdminReports'), 'AdminReports');
const UserManagement = lazyNamed(() => import('./pages/admin/masters/UserManagement'), 'UserManagement');
const ProductManagement = lazyNamed(() => import('./pages/admin/masters/ProductManagement'), 'ProductManagement');
const SupplierManagement = lazyNamed(() => import('./pages/admin/masters/SupplierManagement'), 'SupplierManagement');
const SupplierMasterManagement = lazyNamed(
  () => import('./pages/admin/masters/SupplierMasterManagement'),
  'SupplierMasterManagement'
);
const UnitManagement = lazyNamed(() => import('./pages/admin/masters/UnitManagement'), 'UnitManagement');
const BranchManagement = lazyNamed(() => import('./pages/admin/masters/BranchManagement'), 'BranchManagement');
const DepartmentManagement = lazyNamed(() => import('./pages/admin/masters/DepartmentManagement'), 'DepartmentManagement');
const DepartmentProductManagement = lazyNamed(
  () => import('./pages/admin/masters/DepartmentProductManagement'),
  'DepartmentProductManagement'
);
const StockCategoryManagement = lazyNamed(
  () => import('./pages/admin/masters/StockCategoryManagement'),
  'StockCategoryManagement'
);
const PurchaseWalkSettings = lazyNamed(
  () => import('./pages/admin/masters/PurchaseWalkSettings'),
  'PurchaseWalkSettings'
);
const RecipeManagement = lazyNamed(() => import('./pages/admin/masters/RecipeManagement'), 'RecipeManagement');
const UnitConversionManagement = lazyNamed(
  () => import('./pages/admin/masters/UnitConversionManagement'),
  'UnitConversionManagement'
);
const WithdrawSourceMappingManagement = lazyNamed(
  () => import('./pages/admin/masters/WithdrawSourceMappingManagement'),
  'WithdrawSourceMappingManagement'
);
const UsageReport = lazyNamed(() => import('./pages/admin/masters/UsageReport'), 'UsageReport');
const SalesReport = lazyNamed(() => import('./pages/admin/masters/SalesReport'), 'SalesReport');
const PriceReport = lazyNamed(() => import('./pages/admin/masters/PriceReport'), 'PriceReport');
const PurchaseReport = lazyNamed(() => import('./pages/admin/masters/PurchaseReport'), 'PurchaseReport');
const LineNotificationSettings = lazyNamed(
  () => import('./pages/admin/masters/LineNotificationSettings'),
  'LineNotificationSettings'
);
const InventoryDashboard = lazyNamed(() => import('./pages/inventory/InventoryDashboard'), 'InventoryDashboard');
const InventoryBalance = lazyNamed(() => import('./pages/inventory/InventoryBalance'), 'InventoryBalance');
const MyStockBalance = lazyNamed(() => import('./pages/inventory/MyStockBalance'), 'MyStockBalance');
const StockMovements = lazyNamed(() => import('./pages/inventory/StockMovements'), 'StockMovements');
const StockCard = lazyNamed(() => import('./pages/inventory/StockCard'), 'StockCard');
const StockVariance = lazyNamed(() => import('./pages/inventory/StockVariance'), 'StockVariance');
const ProductionTransform = lazyNamed(
  () => import('./pages/production/ProductionTransform'),
  'ProductionTransform'
);
const PurchaseOrderHistory = lazyNamed(
  () => import('./pages/store/PurchaseOrderHistory'),
  'PurchaseOrderHistory'
);
const PurchaseOrderCreate = lazyNamed(
  () => import('./pages/store/PurchaseOrderCreate'),
  'PurchaseOrderCreate'
);
const PurchaseOrderReceive = lazyNamed(
  () => import('./pages/store/PurchaseOrderReceive'),
  'PurchaseOrderReceive'
);

const ProtectedRoute = ({
  children,
  requireAdmin,
  requireProduction,
  requireSupplierOrders,
  requireProductGroupOrders,
  requireStockCheck,
  disallowSuperAdmin = false
}) => {
  const {
    user,
    loading,
    isAdmin,
    isSuperAdmin,
    isProduction,
    canViewProductGroupOrders,
    canViewSupplierOrders,
    canUseStockCheck
  } = useAuth();

  if (loading) {
    return <Loading fullScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Basic admin check
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (requireProduction && !isProduction) {
    return <Navigate to="/" replace />;
  }

  const canViewGroupOrders = canViewProductGroupOrders ?? canViewSupplierOrders;
  const canUseProductGroupRoute = isAdmin || isProduction || canViewGroupOrders;
  const canUseSupplierRoute = isAdmin || canViewGroupOrders;

  if (requireProductGroupOrders && !canUseProductGroupRoute) {
    return <Navigate to="/" replace />;
  }

  if (requireSupplierOrders && !canUseSupplierRoute) {
    return <Navigate to="/" replace />;
  }

  if (requireStockCheck && !canUseStockCheck) {
    return <Navigate to="/" replace />;
  }

  if (disallowSuperAdmin && isSuperAdmin) {
    return <Navigate to="/admin/settings" replace />;
  }

  return children;
};

const App = () => {
  return (
    <Suspense fallback={<Loading fullScreen />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Protected Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <FunctionSelect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/order"
          element={
            <ProtectedRoute>
              <ProductList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/order/receive"
          element={
            <ProtectedRoute>
              <ReceiveOrders />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production/print-orders"
          element={
            <ProtectedRoute requireSupplierOrders>
              <AdminOrderHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production/transform"
          element={
            <ProtectedRoute requireProduction>
              <ProductionTransform />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cart"
          element={
            <ProtectedRoute>
              <Cart />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock-check"
          element={
            <ProtectedRoute disallowSuperAdmin requireStockCheck>
              <StockCheck />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <UserOrderHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/withdraw"
          element={
            <ProtectedRoute requireProductGroupOrders>
              <WithdrawStock />
            </ProtectedRoute>
          }
        />

        {/* Admin Routes */}
        <Route
          path="/admin/orders"
          element={
            <ProtectedRoute requireAdmin disallowSuperAdmin>
              <OrdersToday />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/history"
          element={
            <ProtectedRoute requireAdmin disallowSuperAdmin>
              <AdminOrderHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/purchase-walk"
          element={
            <ProtectedRoute requireAdmin disallowSuperAdmin>
              <PurchaseWalk />
            </ProtectedRoute>
          }
        />

        {/* Master Data Management */}
        <Route path="/admin/settings" element={
          <ProtectedRoute requireAdmin>
            <AdminSettings />
          </ProtectedRoute>
        } />
        <Route path="/admin/reports" element={
          <ProtectedRoute requireAdmin>
            <AdminReports />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/users" element={
          <ProtectedRoute requireAdmin>
            <UserManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/products" element={
          <ProtectedRoute requireAdmin>
            <ProductManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/suppliers" element={
          <ProtectedRoute requireAdmin>
            <SupplierMasterManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/product-groups" element={
          <ProtectedRoute requireAdmin>
            <SupplierManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/units" element={
          <ProtectedRoute requireAdmin>
            <UnitManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/branches" element={
          <ProtectedRoute requireAdmin>
            <BranchManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/departments" element={
          <ProtectedRoute requireAdmin>
            <DepartmentManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/stock-templates" element={
          <ProtectedRoute requireAdmin>
            <StockCategoryManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/department-products" element={
          <ProtectedRoute requireAdmin>
            <DepartmentProductManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/stock-categories" element={
          <ProtectedRoute requireAdmin>
            <StockCategoryManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/purchase-walk" element={
          <ProtectedRoute requireAdmin>
            <PurchaseWalkSettings />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/recipes" element={
          <ProtectedRoute requireAdmin>
            <RecipeManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/unit-conversions" element={
          <ProtectedRoute requireAdmin>
            <UnitConversionManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/withdraw-source-mappings" element={
          <ProtectedRoute requireAdmin>
            <WithdrawSourceMappingManagement />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/usage-report" element={
          <ProtectedRoute requireAdmin>
            <UsageReport />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/sales-report" element={
          <ProtectedRoute requireAdmin>
            <SalesReport />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/price-report" element={
          <ProtectedRoute requireAdmin>
            <PriceReport />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/purchase-report" element={
          <ProtectedRoute requireAdmin>
            <PurchaseReport />
          </ProtectedRoute>
        } />
        <Route path="/admin/settings/line-notifications" element={
          <ProtectedRoute requireAdmin>
            <LineNotificationSettings />
          </ProtectedRoute>
        } />
        {/* Inventory System Routes */}
        <Route path="/inventory" element={
          <ProtectedRoute>
            <InventoryDashboard />
          </ProtectedRoute>
        } />
        <Route path="/inventory/balance" element={
          <ProtectedRoute>
            <InventoryBalance />
          </ProtectedRoute>
        } />
        <Route path="/inventory/movements" element={
          <ProtectedRoute>
            <StockMovements />
          </ProtectedRoute>
        } />
        <Route path="/inventory/stock-card/:productId/:departmentId" element={
          <ProtectedRoute>
            <StockCard />
          </ProtectedRoute>
        } />
        <Route path="/inventory/stock-card" element={<Navigate to="/inventory/balance" replace />} />
        <Route path="/inventory/my-stock" element={
          <ProtectedRoute>
            <MyStockBalance />
          </ProtectedRoute>
        } />
        <Route path="/inventory/variance" element={
          <ProtectedRoute>
            <StockVariance />
          </ProtectedRoute>
        } />

        {/* Purchase Order Routes */}
        <Route
          path="/purchase-orders"
          element={
            <ProtectedRoute>
              <PurchaseOrderHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders/new"
          element={
            <ProtectedRoute>
              <PurchaseOrderCreate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-orders/:id"
          element={
            <ProtectedRoute>
              <PurchaseOrderReceive />
            </ProtectedRoute>
          }
        />

        {/* Admin Redirect */}
        <Route
          path="/admin"
          element={<Navigate to="/admin/orders" replace />}
        />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

export default App;
