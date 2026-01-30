import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { Login } from './pages/auth/Login';
import { ProductList } from './pages/user/ProductList';
import { Cart } from './pages/user/Cart';
import { StockCheck } from './pages/user/StockCheck';
import { OrderHistory } from './pages/user/OrderHistory';
import { OrdersToday } from './pages/admin/OrdersToday';
import { OrderHistory as AdminOrderHistory } from './pages/admin/OrderHistory';
import { PurchaseWalk } from './pages/admin/PurchaseWalk';
import { AdminSettings } from './pages/admin/AdminSettings';
import { UserManagement } from './pages/admin/masters/UserManagement';
import { ProductManagement } from './pages/admin/masters/ProductManagement';
import { SupplierManagement } from './pages/admin/masters/SupplierManagement';
import { UnitManagement } from './pages/admin/masters/UnitManagement';
import { BranchManagement } from './pages/admin/masters/BranchManagement';
import { DepartmentManagement } from './pages/admin/masters/DepartmentManagement';
import { StockTemplateManagement } from './pages/admin/masters/StockTemplateManagement';
import { DepartmentProductManagement } from './pages/admin/masters/DepartmentProductManagement';
import { StockCategoryManagement } from './pages/admin/masters/StockCategoryManagement';
import { PurchaseWalkSettings } from './pages/admin/masters/PurchaseWalkSettings';
import { RecipeManagement } from './pages/admin/masters/RecipeManagement';
import { UnitConversionManagement } from './pages/admin/masters/UnitConversionManagement';
import { UsageReport } from './pages/admin/masters/UsageReport';
import { SalesReport } from './pages/admin/masters/SalesReport';
import { PriceReport } from './pages/admin/masters/PriceReport';
import { PurchaseReport } from './pages/admin/masters/PurchaseReport';
import { LineNotificationSettings } from './pages/admin/masters/LineNotificationSettings';
import { Loading } from './components/common/Loading';

const ProtectedRoute = ({ children, requireAdmin, disallowSuperAdmin = false }) => {
  const { user, loading, isAdmin, isSuperAdmin } = useAuth();

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

  if (disallowSuperAdmin && isSuperAdmin) {
    return <Navigate to="/admin/settings" replace />;
  }

  return children;
};

const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Protected Routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <ProductList />
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
          <ProtectedRoute>
            <StockCheck />
          </ProtectedRoute>
        }
      />
      <Route
        path="/orders"
        element={
          <ProtectedRoute>
            <OrderHistory />
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
          <StockTemplateManagement />
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

      {/* Admin Redirect */}
      <Route
        path="/admin"
        element={<Navigate to="/admin/orders" replace />}
      />

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
