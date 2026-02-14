import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { formatPrice, getProductPrice, getProductCurrency, getProductThumbnail, productSlug } from '@/lib/utils';

export default function ProductCard({ product }) {
  const { addItem } = useCart();
  const thumbnail = getProductThumbnail(product);
  const price = getProductPrice(product);
  const currency = getProductCurrency(product);
  const defaultVariant = product.variants?.[0];

  // Check for sale: if variant has a calculated_price vs original_price
  const hasComparePrice = defaultVariant?.original_price != null
    && defaultVariant?.calculated_price != null
    && defaultVariant.original_price > defaultVariant.calculated_price;

  function handleQuickAdd(e) {
    e.preventDefault();
    e.stopPropagation();
    if (defaultVariant) {
      addItem(defaultVariant.id);
    }
  }

  return (
    <Link
      to={`/products/${productSlug(product)}`}
      className="group block"
    >
      {/* Image */}
      <div className="relative aspect-square rounded-2xl bg-surface-100 overflow-hidden mb-3">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={product.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <ShoppingBag className="h-10 w-10 text-surface-300" />
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {hasComparePrice && <span className="badge-sale">Sale</span>}
          {product.metadata?.new === 'true' && <span className="badge-new">New</span>}
        </div>

        {/* Quick add button */}
        {defaultVariant && (
          <button
            onClick={handleQuickAdd}
            className="absolute bottom-3 right-3 h-10 w-10 rounded-xl bg-white shadow-lg
                       flex items-center justify-center
                       opacity-0 translate-y-2 transition-all duration-200
                       group-hover:opacity-100 group-hover:translate-y-0
                       hover:bg-surface-900 hover:text-white active:scale-95"
            aria-label="Add to cart"
          >
            <ShoppingBag className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-surface-900 group-hover:text-brand-600 transition-colors line-clamp-1">
          {product.title}
        </h3>
        {product.subtitle && (
          <p className="text-xs text-surface-400 line-clamp-1">{product.subtitle}</p>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-surface-900 tabular-nums">
            {price != null ? formatPrice(price, currency) : '—'}
          </span>
          {hasComparePrice && (
            <span className="text-xs text-surface-400 line-through tabular-nums">
              {formatPrice(defaultVariant.original_price, currency)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
