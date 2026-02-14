import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '@/api/medusa';
import { useStore } from '@/context/StoreContext';
import ProductGrid from '@/components/products/ProductGrid';
import ProductFilter from '@/components/products/ProductFilter';

const PAGE_SIZE = 24;

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { collections, categories } = useStore();
  const [products, setProducts] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const q = searchParams.get('q') || '';
  const collectionId = searchParams.get('collection') || '';
  const categoryId = searchParams.get('category') || '';
  const sortBy = searchParams.get('sort') || '';

  const fetchProducts = useCallback(async (pg = 0) => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, offset: pg * PAGE_SIZE };
      if (q) params.q = q;
      if (collectionId) params.collection_id = collectionId;
      if (categoryId) params.category_id = categoryId;
      if (sortBy) params.order = sortBy;

      const result = await api.listProducts(params);
      setProducts(result.products);
      setCount(result.count);
    } catch (err) {
      console.error('Failed to load products:', err);
    }
    setLoading(false);
  }, [q, collectionId, categoryId, sortBy]);

  useEffect(() => {
    setPage(0);
    fetchProducts(0);
  }, [fetchProducts]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  function setFilter(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  function handlePageChange(newPage) {
    setPage(newPage);
    fetchProducts(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight text-surface-900">
          {q ? `Results for "${q}"` : 'All Products'}
        </h1>
        {count > 0 && (
          <p className="text-sm text-surface-500 mt-1">
            {count} product{count !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="mb-8">
        <ProductFilter
          collections={collections}
          categories={categories}
          activeCollection={collectionId}
          activeCategory={categoryId}
          sortBy={sortBy}
          onCollectionChange={(id) => setFilter('collection', id)}
          onCategoryChange={(id) => setFilter('category', id)}
          onSortChange={(val) => setFilter('sort', val)}
          onClear={() => setSearchParams({})}
        />
      </div>

      {/* Grid */}
      <ProductGrid products={products} loading={loading} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-12">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 0}
            className="btn-ghost disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-surface-500 mx-4">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages - 1}
            className="btn-ghost disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
