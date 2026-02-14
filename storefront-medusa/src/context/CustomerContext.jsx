import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import * as api from '@/api/medusa';

const CustomerContext = createContext(null);

export function CustomerProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  /* ── Check session on mount ──────────────── */
  useEffect(() => {
    async function checkSession() {
      try {
        const c = await api.getSession();
        setCustomer(c);
      } catch {
        // Not logged in — that's fine
        setCustomer(null);
      }
      setLoading(false);
    }
    checkSession();
  }, []);

  /* ── Login ───────────────────────────────── */
  const login = useCallback(async (email, password) => {
    const c = await api.customerLogin(email, password);
    setCustomer(c);
    return c;
  }, []);

  /* ── Register ────────────────────────────── */
  const register = useCallback(async (data) => {
    const c = await api.customerRegister(data);
    // Auto-login after registration
    const loggedIn = await api.customerLogin(data.email, data.password);
    setCustomer(loggedIn);
    return loggedIn;
  }, []);

  /* ── Logout ──────────────────────────────── */
  const logout = useCallback(async () => {
    try {
      await api.customerLogout();
    } catch {
      // ignore — session may already be gone
    }
    setCustomer(null);
  }, []);

  /* ── Refresh profile ─────────────────────── */
  const refreshCustomer = useCallback(async () => {
    try {
      const c = await api.getCustomer();
      setCustomer(c);
    } catch {
      setCustomer(null);
    }
  }, []);

  const value = useMemo(() => ({
    customer,
    loading,
    isLoggedIn: !!customer,
    login,
    register,
    logout,
    refreshCustomer,
  }), [customer, loading, login, register, logout, refreshCustomer]);

  return (
    <CustomerContext.Provider value={value}>
      {children}
    </CustomerContext.Provider>
  );
}

export function useCustomer() {
  const ctx = useContext(CustomerContext);
  if (!ctx) throw new Error('useCustomer must be used inside <CustomerProvider>');
  return ctx;
}
