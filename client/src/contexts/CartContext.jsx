import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

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

// โหลด cart จาก sessionStorage (แยกตามแท็บ) ตอนสร้าง state เลย
// (ถ้าโหลดใน effect ตัว effect บันทึกจะเขียน [] ทับก่อนใน StrictMode ทำให้ตะกร้าหายเมื่อรีเฟรช)
const readSavedCart = () => {
  const savedCart = sessionStorage.getItem('cart');
  if (!savedCart) return [];
  try {
    const parsed = JSON.parse(savedCart);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to parse cart:', e);
    sessionStorage.removeItem('cart');
    return [];
  }
};

const readSavedOrderDate = () => {
  const savedOrderDate = sessionStorage.getItem('orderDate');
  // วันที่ที่ค้างไว้จากวันก่อน (ผ่านมาแล้ว) ใช้สั่งไม่ได้ ให้กลับเป็นค่าเริ่มต้น
  if (savedOrderDate && savedOrderDate >= toLocalDateString(new Date())) {
    return savedOrderDate;
  }
  return getTomorrowString();
};

export const CartProvider = ({ children }) => {
  const { user } = useAuth();
  const [cartItems, setCartItems] = useState(readSavedCart);
  const [orderDate, setOrderDate] = useState(readSavedOrderDate);
  const userId = user?.id ?? null;
  const [trackedUserId, setTrackedUserId] = useState(userId);

  // ออกจากระบบ/เปลี่ยนผู้ใช้: ล้างตะกร้า ไม่ให้ผู้ใช้คนถัดไปเห็นหรือส่งตะกร้าของคนก่อน
  // (ตอนโหลดหน้าใหม่ user จะเปลี่ยนจาก null เป็นผู้ใช้เดิม ซึ่งไม่ถือเป็นการเปลี่ยนผู้ใช้)
  if (trackedUserId !== userId) {
    setTrackedUserId(userId);
    // ตะกร้าที่ค้างใน sessionStorage เป็นของผู้ใช้อื่น (เช่น ถูกเด้งออกเพราะ token หมดอายุ แล้วคนอื่น login ต่อ)
    const savedOwner = sessionStorage.getItem('cartOwner');
    const ownedByOther = userId !== null && savedOwner !== null && savedOwner !== String(userId);
    if (trackedUserId !== null || ownedByOther) {
      setCartItems([]);
      setOrderDate(getTomorrowString());
    }
  }

  useEffect(() => {
    if (userId !== null) {
      sessionStorage.setItem('cartOwner', String(userId));
    }
  }, [userId]);

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

  // หลังส่งคำสั่งซื้อ: ล้างตะกร้าแต่ตั้งวันที่กลับเป็นค่าเริ่มต้น (พรุ่งนี้) เพื่อสั่งต่อได้ทันที
  const clearCart = () => {
    setCartItems([]);
    setOrderDate(getTomorrowString());
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
