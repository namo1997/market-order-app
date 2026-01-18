import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useCart } from '../../contexts/CartContext';

export const Header = () => {
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();
  const { itemCount } = useCart();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="bg-blue-600 text-white shadow-md print:hidden">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-4">
            <h1
              className="text-xl font-bold cursor-pointer"
              onClick={() => navigate('/')}
            >
              ตลาดสด
            </h1>
            {isAdmin && (
              <span className="bg-yellow-500 text-xs px-2 py-1 rounded-full">
                ADMIN
              </span>
            )}
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-sm">
              <p className="font-medium">{user?.name}</p>
              <p className="text-blue-200 text-xs">{user?.branch}</p>
            </div>

            {!isAdmin && (
              <button
                onClick={() => navigate('/cart')}
                className="relative p-2 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
                {itemCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                    {itemCount}
                  </span>
                )}
              </button>
            )}

            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-800 rounded-lg text-sm transition-colors"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
