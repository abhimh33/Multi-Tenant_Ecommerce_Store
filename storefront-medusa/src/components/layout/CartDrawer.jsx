import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { X, Minus, Plus, ShoppingBag, ArrowRight, Trash2 } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { formatPrice, getProductThumbnail } from '@/lib/utils';

export default function CartDrawer() {
  const { cart, open, setOpen, updateItem, removeItem, loading, itemCount } = useCart();

  if (!open) return null;

  const items = cart?.items || [];
  const subtotal = cart?.subtotal ?? 0;
  const currencyCode = cart?.region?.currency_code || 'usd';

  return (
    <Fragment>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={() => setOpen(false)}
      />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-surface-700" />
            <h2 className="font-display font-semibold text-lg">Cart</h2>
            {itemCount > 0 && (
              <span className="badge bg-surface-100 text-surface-600">{itemCount}</span>
            )}
          </div>
          <button onClick={() => setOpen(false)} className="btn-ghost p-2" aria-label="Close cart">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="h-16 w-16 rounded-full bg-surface-100 flex items-center justify-center">
                <ShoppingBag className="h-7 w-7 text-surface-400" />
              </div>
              <p className="text-surface-500 font-medium">Your cart is empty</p>
              <button onClick={() => setOpen(false)} className="btn-primary text-sm">
                Continue Shopping
              </button>
            </div>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <CartItemRow
                  key={item.id}
                  item={item}
                  currencyCode={currencyCode}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                  disabled={loading}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer — subtotal & checkout */}
        {items.length > 0 && (
          <div className="border-t border-surface-100 px-6 py-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-surface-500">Subtotal</span>
              <span className="text-lg font-semibold">
                {formatPrice(subtotal, currencyCode)}
              </span>
            </div>
            <p className="text-xs text-surface-400">
              Shipping &amp; taxes calculated at checkout.
            </p>
            <Link
              to="/checkout"
              onClick={() => setOpen(false)}
              className="btn-primary w-full justify-center"
            >
              Checkout
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </aside>
    </Fragment>
  );
}

/* ── Cart item row ─────────────────────────── */
function CartItemRow({ item, currencyCode, onUpdate, onRemove, disabled }) {
  const thumbnail = getProductThumbnail(item) || item.thumbnail;
  const title = item.title;
  const variant = item.description || item.variant?.title || '';
  const unitPrice = item.unit_price ?? 0;

  return (
    <li className="flex gap-4 animate-fade-in">
      {/* Thumbnail */}
      <div className="h-20 w-20 flex-shrink-0 rounded-xl bg-surface-100 overflow-hidden">
        {thumbnail ? (
          <img src={thumbnail} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-surface-300">
            <ShoppingBag className="h-6 w-6" />
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div>
          <h3 className="text-sm font-medium text-surface-900 truncate">{title}</h3>
          {variant && (
            <p className="text-xs text-surface-400 mt-0.5">{variant}</p>
          )}
        </div>

        <div className="flex items-center justify-between mt-2">
          {/* Quantity controls */}
          <div className="flex items-center border border-surface-200 rounded-lg">
            <button
              onClick={() => item.quantity > 1 ? onUpdate(item.id, item.quantity - 1) : onRemove(item.id)}
              disabled={disabled}
              className="px-2 py-1 text-surface-500 hover:text-surface-900 transition-colors disabled:opacity-40"
              aria-label="Decrease quantity"
            >
              {item.quantity === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            </button>
            <span className="px-3 text-sm font-medium tabular-nums min-w-[2rem] text-center">
              {item.quantity}
            </span>
            <button
              onClick={() => onUpdate(item.id, item.quantity + 1)}
              disabled={disabled}
              className="px-2 py-1 text-surface-500 hover:text-surface-900 transition-colors disabled:opacity-40"
              aria-label="Increase quantity"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Price */}
          <span className="text-sm font-semibold tabular-nums">
            {formatPrice(unitPrice * item.quantity, currencyCode)}
          </span>
        </div>
      </div>
    </li>
  );
}
