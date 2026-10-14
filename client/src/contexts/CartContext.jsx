import { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext(null);

const toLocalDateString = (date) => {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().split('T')[0];
};

const getTomorrowString = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return toLocalDateString(tomorrow);
};

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState([]);
  const [orderDate, setOrderDate] = useState('');

  // โหลด cart จาก sessionStorage (แยกตามแท็บ)
  useEffect(() => {
    const savedCart = sessionStorage.getItem('cart');
    if (savedCart) {
      try {
        const parsed = JSON.parse(savedCart);
        if (Array.isArray(parsed)) {
          setCartItems(parsed);
        }
      } catch (e) {
        console.error('Failed to parse cart:', e);
        sessionStorage.removeItem('cart');
      }
    }
    const savedOrderDate = sessionStorage.getItem('orderDate');
    if (savedOrderDate) {
      setOrderDate(savedOrderDate);
    } else {
      setOrderDate(getTomorrowString());
    }
  }, []);

  // บันทึก cart ลง sessionStorage เมื่อมีการเปลี่ยนแปลง
  useEffect(() => {
    sessionStorage.setItem('cart', JSON.stringify(cartItems));
  }, [cartItems]);

  useEffect(() => {
    if (orderDate) {
      sessionStorage.setItem('orderDate', orderDate);
    } else {
      sessionStorage.removeItem('orderDate');
    }
  }, [orderDate]);

  const addToCart = (product, quantity, note, options = {}) => {
    const sourceProductGroupId = Number.isFinite(Number(options.sourceProductGroupId))
      ? Number(options.sourceProductGroupId)
      : null;
    const sourceProductGroupName =
      String(options.sourceProductGroupName || '').trim() || null;

    setCartItems((prev) => {
      const existing = prev.find((item) => item.product_id === product.id);

      if (existing) {
        // เพิ่มจำนวน
        return prev.map((item) => {
          if (item.product_id !== product.id) return item;
          return {
            ...item,
            quantity: item.quantity + quantity,
            note: note !== undefined ? note : item.note,
            source_product_group_id:
              sourceProductGroupId ?? item.source_product_group_id ?? null,
            source_product_group_name:
              sourceProductGroupName ?? item.source_product_group_name ?? null
          };
        });
      } else {
        // เพิ่มรายการใหม่
        return [
          ...prev,
          {
            product_id: product.id,
            product_name: product.name,
            unit_name: product.unit_name,
            unit_abbr: product.unit_abbr,
            requested_price: product.default_price,
            quantity,
            note: note || '',
            source_product_group_id: sourceProductGroupId,
            source_product_group_name: sourceProductGroupName
          }
        ];
      }
    });
  };

  const updateQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    setCartItems((prev) =>
      prev.map((item) =>
        item.product_id === productId ? { ...item, quantity } : item
      )
    );
  };

  const updatePrice = (productId, price) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.product_id === productId ? { ...item, requested_price: price } : item
      )
    );
  };

  const updateNote = (productId, note) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.product_id === productId ? { ...item, note } : item
      )
    );
  };

  const updateSourceGroup = (productId, sourceGroupId, sourceGroupName = null) => {
    const normalizedGroupId = Number.isFinite(Number(sourceGroupId))
      ? Number(sourceGroupId)
      : null;
    const normalizedGroupName =
      sourceGroupName !== undefined && sourceGroupName !== null
        ? String(sourceGroupName).trim() || null
        : null;

    setCartItems((prev) =>
      prev.map((item) =>
        item.product_id === productId
          ? {
              ...item,
              source_product_group_id: normalizedGroupId,
              source_product_group_name:
                normalizedGroupName ?? item.source_product_group_name ?? null
            }
          : item
      )
    );
  };

  const removeFromCart = (productId) => {
    setCartItems((prev) => prev.filter((item) => item.product_id !== productId));
  };

  const clearCart = () => {
    setCartItems([]);
    setOrderDate('');
  };

  const totalAmount = cartItems.reduce(
    (sum, item) => sum + item.quantity * item.requested_price,
    0
  );

  const itemCount = cartItems.length;

  return (
    <CartContext.Provider
      value={{
        cartItems,
        addToCart,
        updateQuantity,
        updatePrice,
        updateNote,
        updateSourceGroup,
        removeFromCart,
        clearCart,
        totalAmount,
        itemCount,
        orderDate,
        setOrderDate
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within CartProvider');
  }
  return context;
};
