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
import { StockCategoryManagement } from './pages/admin/masters/StockCategoryManagement';
import { PurchaseWalkSettings } from './pages/admin/masters/PurchaseWalkSettings';
import { Loading } from './components/common/Loading';

const ProtectedRoute = ({ children, requireAdmin }) => {
  const { user, loading, isAdmin } = useAuth();

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
          <ProtectedRoute requireAdmin>
            <OrdersToday />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/history"
        element={
          <ProtectedRoute requireAdmin>
            <AdminOrderHistory />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/purchase-walk"
        element={
          <ProtectedRoute requireAdmin>
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
