import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import * as api from '@/api/medusa';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [regions, setRegions] = useState([]);
  const [collections, setCollections] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [regs, colls, cats] = await Promise.allSettled([
          api.listRegions(),
          api.listCollections(),
          api.listCategories(),
        ]);
        if (regs.status === 'fulfilled')  setRegions(regs.value);
        if (colls.status === 'fulfilled') setCollections(colls.value);
        if (cats.status === 'fulfilled')  setCategories(cats.value);
      } catch (err) {
        console.error('Store context init failed:', err);
      }
      setLoading(false);
    }
    load();
  }, []);

  const defaultRegion = useMemo(() => regions[0] || null, [regions]);

  const value = useMemo(() => ({
    regions,
    defaultRegion,
    collections,
    categories,
    loading,
  }), [regions, defaultRegion, collections, categories, loading]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be inside StoreProvider');
  return ctx;
}
