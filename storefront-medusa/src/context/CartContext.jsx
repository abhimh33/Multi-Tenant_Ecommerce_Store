import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import * as api from '@/api/medusa';

const CartContext = createContext(null);

const CART_ID_KEY = 'medusa_cart_id';

function getStoredCartId() {
  try { return localStorage.getItem(CART_ID_KEY); } catch { return null; }
}
function storeCartId(id) {
  try { localStorage.setItem(CART_ID_KEY, id); } catch { /* ignore */ }
}
function clearCartId() {
  try { localStorage.removeItem(CART_ID_KEY); } catch { /* ignore */ }
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  /* ── Initialise or recover the cart ──────── */
  useEffect(() => {
    async function init() {
      const storedId = getStoredCartId();
      if (storedId) {
        try {
          const c = await api.getCart(storedId);
          if (c.completed_at) throw new Error('completed');
          setCart(c);
          setLoading(false);
          return;
        } catch {
          clearCartId();
        }
      }
      // Create a new cart
      try {
        const regions = await api.listRegions();
        const region = regions[0]; // default region
        const c = await api.createCart(region?.id);
        storeCartId(c.id);
        setCart(c);
      } catch (err) {
        console.error('Failed to create cart:', err);
      }
      setLoading(false);
    }
    init();
  }, []);

  /* ── Cart actions ────────────────────────── */
  const addItem = useCallback(async (variantId, quantity = 1) => {
    if (!cart) return;
    setLoading(true);
    try {
      const updated = await api.addLineItem(cart.id, variantId, quantity);
      setCart(updated);
      setOpen(true); // open drawer on add
    } catch (err) {
      console.error('Add to cart failed:', err);
    }
    setLoading(false);
  }, [cart]);

  const updateItem = useCallback(async (lineId, quantity) => {
    if (!cart) return;
    setLoading(true);
    try {
      const updated = await api.updateLineItem(cart.id, lineId, quantity);
      setCart(updated);
    } catch (err) {
      console.error('Update item failed:', err);
    }
    setLoading(false);
  }, [cart]);

  const removeItem = useCallback(async (lineId) => {
    if (!cart) return;
    setLoading(true);
    try {
      const updated = await api.removeLineItem(cart.id, lineId);
      setCart(updated);
    } catch (err) {
      console.error('Remove item failed:', err);
    }
    setLoading(false);
  }, [cart]);

  const refreshCart = useCallback(async () => {
    if (!cart) return;
    try {
      const updated = await api.getCart(cart.id);
      setCart(updated);
    } catch (err) {
      console.error('Refresh cart failed:', err);
    }
  }, [cart]);

  const resetCart = useCallback(async () => {
    clearCartId();
    try {
      const regions = await api.listRegions();
      const c = await api.createCart(regions[0]?.id);
      storeCartId(c.id);
      setCart(c);
    } catch (err) {
      console.error('Reset cart failed:', err);
    }
  }, []);

  const itemCount = useMemo(() => {
    if (!cart?.items?.length) return 0;
    return cart.items.reduce((sum, i) => sum + i.quantity, 0);
  }, [cart]);

  const value = useMemo(() => ({
    cart,
    setCart,
    loading,
    open,
    setOpen,
    addItem,
    updateItem,
    removeItem,
    refreshCart,
    resetCart,
    itemCount,
  }), [cart, loading, open, addItem, updateItem, removeItem, refreshCart, resetCart, itemCount]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be inside CartProvider');
  return ctx;
}
