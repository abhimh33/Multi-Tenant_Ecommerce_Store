import ProductCard from './ProductCard';

export default function ProductGrid({ products, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!products.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-16 w-16 rounded-full bg-surface-100 flex items-center justify-center mb-4">
          <span className="text-2xl">🔍</span>
        </div>
        <h3 className="font-semibold text-surface-700 mb-1">No products found</h3>
        <p className="text-sm text-surface-400">Try adjusting your filters or search query.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {products.map((product, i) => (
        <div key={product.id} className="animate-fade-up" style={{ animationDelay: `${i * 30}ms` }}>
          <ProductCard product={product} />
        </div>
      ))}
    </div>
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
