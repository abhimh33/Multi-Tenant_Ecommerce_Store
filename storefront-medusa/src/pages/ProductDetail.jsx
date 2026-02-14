import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ShoppingBag, Minus, Plus, ChevronLeft, Check, Truck, RefreshCw, Shield } from 'lucide-react';
import * as api from '@/api/medusa';
import { useCart } from '@/context/CartContext';
import { formatPrice, getProductCurrency } from '@/lib/utils';

export default function ProductDetail() {
  const { handle } = useParams();
  const { addItem, loading: cartLoading } = useCart();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getProduct(handle)
      .then((p) => {
        setProduct(p);
        setSelectedVariant(p.variants?.[0] || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [handle]);

  async function handleAddToCart() {
    if (!selectedVariant) return;
    await addItem(selectedVariant.id, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  if (loading) return <ProductDetailSkeleton />;
  if (!product) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-20 text-center">
        <h2 className="text-xl font-semibold text-surface-700">Product not found</h2>
        <Link to="/products" className="btn-primary mt-6">Back to Shop</Link>
      </div>
    );
  }

  const images = product.images?.length ? product.images : [{ url: product.thumbnail }];
  const currency = getProductCurrency(product);
  const price = selectedVariant?.prices?.[0]?.amount;
  const hasOptions = product.options?.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="mb-8">
        <Link to="/products" className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-900 transition-colors">
          <ChevronLeft className="h-4 w-4" />
          Back to shop
        </Link>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* ── Images ─────────────────────────── */}
        <div className="space-y-4">
          {/* Main image */}
          <div className="aspect-square rounded-3xl bg-surface-100 overflow-hidden">
            {images[activeImage]?.url ? (
              <img
                src={images[activeImage].url}
                alt={product.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center">
                <ShoppingBag className="h-16 w-16 text-surface-300" />
              </div>
            )}
          </div>
          {/* Thumbnails */}
          {images.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(i)}
                  className={`h-20 w-20 flex-shrink-0 rounded-xl overflow-hidden border-2 transition-all
                    ${i === activeImage ? 'border-surface-900 ring-2 ring-surface-900/20' : 'border-transparent hover:border-surface-300'}`}
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Product info ───────────────────── */}
        <div className="flex flex-col">
          {/* Collection / subtitle */}
          {product.collection && (
            <Link
              to={`/products?collection=${product.collection.id}`}
              className="text-sm font-medium text-brand-600 hover:text-brand-700 mb-2"
            >
              {product.collection.title}
            </Link>
          )}

          <h1 className="font-display text-3xl sm:text-4xl font-bold text-surface-900 tracking-tight">
            {product.title}
          </h1>

          {product.subtitle && (
            <p className="text-surface-500 mt-2">{product.subtitle}</p>
          )}

          {/* Price */}
          <div className="mt-6 flex items-baseline gap-3">
            <span className="text-3xl font-bold text-surface-900 tabular-nums">
              {price != null ? formatPrice(price, currency) : '—'}
            </span>
          </div>

          {/* Description */}
          {product.description && (
            <div className="mt-6 text-sm text-surface-600 leading-relaxed prose prose-sm max-w-none">
              <p>{product.description}</p>
            </div>
          )}

          {/* Divider */}
          <div className="my-6 border-t border-surface-100" />

          {/* Options (variant selector) */}
          {hasOptions && (
            <div className="space-y-4 mb-6">
              {product.options.map((option) => (
                <div key={option.id}>
                  <label className="text-sm font-medium text-surface-700 mb-2 block">
                    {option.title}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {option.values?.map((val) => {
                      const variantForValue = product.variants.find(
                        (v) => v.options?.some((o) => o.value === val.value)
                      );
                      const isSelected = selectedVariant?.id === variantForValue?.id;
                      return (
                        <button
                          key={val.id}
                          onClick={() => variantForValue && setSelectedVariant(variantForValue)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all
                            ${isSelected
                              ? 'bg-surface-900 text-white border-surface-900'
                              : 'bg-white text-surface-700 border-surface-200 hover:border-surface-400'
                            }`}
                        >
                          {val.value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quantity + Add to Cart */}
          <div className="flex items-center gap-4">
            {/* Quantity */}
            <div className="flex items-center border border-surface-200 rounded-lg">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-3 py-3 text-surface-500 hover:text-surface-900 transition-colors"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="px-4 text-sm font-semibold tabular-nums min-w-[3rem] text-center">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="px-3 py-3 text-surface-500 hover:text-surface-900 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Add to cart */}
            <button
              onClick={handleAddToCart}
              disabled={!selectedVariant || cartLoading}
              className={`btn-primary flex-1 ${added ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
            >
              {added ? (
                <>
                  <Check className="h-4 w-4" />
                  Added!
                </>
              ) : (
                <>
                  <ShoppingBag className="h-4 w-4" />
                  Add to Cart
                </>
              )}
            </button>
          </div>

          {/* Trust badges */}
          <div className="mt-8 grid grid-cols-3 gap-4">
            {[
              { icon: Truck, label: 'Free Shipping' },
              { icon: RefreshCw, label: 'Easy Returns' },
              { icon: Shield, label: 'Secure Pay' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center text-center gap-1.5 py-3 rounded-xl bg-surface-50">
                <Icon className="h-4 w-4 text-surface-500" />
                <span className="text-xs text-surface-500 font-medium">{label}</span>
              </div>
            ))}
          </div>

          {/* Meta info */}
          {product.metadata && Object.keys(product.metadata).length > 0 && (
            <div className="mt-6 space-y-2 text-xs text-surface-400">
              {product.material && <p>Material: {product.material}</p>}
              {product.weight && <p>Weight: {product.weight}g</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductDetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="skeleton h-5 w-32 rounded mb-8" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div className="skeleton aspect-square rounded-3xl" />
        <div className="space-y-4">
          <div className="skeleton h-6 w-24 rounded" />
          <div className="skeleton h-10 w-3/4 rounded" />
          <div className="skeleton h-8 w-32 rounded mt-4" />
          <div className="skeleton h-24 w-full rounded mt-4" />
          <div className="skeleton h-12 w-full rounded mt-6" />
        </div>
      </div>
    </div>
  );
}
