import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import * as api from '@/api/medusa';
import ProductCard from '@/components/products/ProductCard';

export default function FeaturedProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listProducts({ limit: 8 })
      .then(({ products: p }) => setProducts(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-sm font-semibold text-brand-600 mb-1">Featured</p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-surface-900">
              Popular Products
            </h2>
          </div>
          <Link
            to="/products"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-surface-600
                       hover:text-surface-900 transition-colors group"
          >
            View all
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* Product grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {products.map((product, i) => (
              <div key={product.id} className="animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
                <ProductCard product={product} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-surface-400">
            <p>No products available yet.</p>
          </div>
        )}

        {/* Mobile view all link */}
        <div className="mt-8 text-center sm:hidden">
          <Link to="/products" className="btn-secondary">
            View All Products
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="skeleton aspect-square rounded-2xl" />
      <div className="skeleton h-4 w-3/4 rounded" />
      <div className="skeleton h-4 w-1/3 rounded" />
    </div>
  );
}
