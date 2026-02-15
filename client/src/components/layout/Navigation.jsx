import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export const Navigation = () => {
  const { isAdmin, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  const navLinkClass = ({ isActive }) =>
    `px-4 py-2 rounded-lg transition-colors ${isActive
      ? 'bg-blue-100 text-blue-700 font-medium'
      : 'text-gray-700 hover:bg-gray-100'
    }`;

  if (isAdmin) {
    return (
      <nav className="bg-white border-b print:hidden">
        <div className="container mx-auto px-4">
          <div className="flex space-x-2 py-2 overflow-x-auto">
            {!isSuperAdmin && (
              <>
                <NavLink to="/admin/orders" className={navLinkClass}>
                  คำสั่งซื้อวันนี้
                </NavLink>
                <NavLink to="/admin/history" className={navLinkClass}>
                  ประวัติคำสั่งซื้อ
                </NavLink>
                <NavLink to="/admin/purchase-walk" className={navLinkClass}>
                  เดินซื้อของ
                </NavLink>
              </>
            )}
            <NavLink to="/admin/settings" className={navLinkClass}>
              ตั้งค่าระบบ
            </NavLink>
          </div>
        </div>
      </nav>
    );
  }

  const isOrderRoute = ['/order', '/orders', '/cart'].some((path) => {
    if (pathname === path) return true;
    if (path === '/order') return false;
    return pathname.startsWith(`${path}/`);
  });

  if (!isOrderRoute) {
    return null;
  }

  return (
  <nav className="bg-white border-b print:hidden">
      <div className="container mx-auto px-4">
        <div className="flex space-x-2 py-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-100"
          >
            ← ย้อนกลับ
          </button>
          <NavLink to="/order" end className={navLinkClass}>
            สั่งซื้อสินค้า
          </NavLink>
          <NavLink to="/orders" className={navLinkClass}>
            การสั่งซื้อของฉัน
          </NavLink>
        </div>
      </div>
    </nav>
  );
};
