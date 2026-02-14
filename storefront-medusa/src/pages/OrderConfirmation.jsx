import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, Package, Mail, MapPin, CreditCard, ShoppingBag, ArrowRight } from 'lucide-react';
import * as api from '@/api/medusa';
import { formatPrice } from '@/lib/utils';

export default function OrderConfirmation() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.getOrder(id)
      .then(setOrder)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-10 w-10 rounded-full border-4 border-surface-200 border-t-surface-900 animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h2 className="text-xl font-semibold text-surface-700">Order not found</h2>
        <Link to="/" className="btn-primary mt-6 inline-flex">Back to Home</Link>
      </div>
    );
  }

  const currency = order.currency_code || 'usd';
  const items = order.items || [];
  const addr = order.shipping_address || {};

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-14">
      {/* Success banner */}
      <div className="text-center mb-12">
        <div className="animate-[scale-in_0.4s_ease-out] inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 mb-5">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-surface-900">
          Thank you for your order!
        </h1>
        <p className="mt-2 text-surface-500">
          Your order <span className="font-mono font-semibold text-surface-700">#{order.display_id}</span> has been placed successfully.
        </p>
        <p className="mt-1 text-sm text-surface-400">
          A confirmation email will be sent to <span className="font-medium text-surface-600">{order.email}</span>.
        </p>
      </div>

      {/* Order details card */}
      <div className="card rounded-2xl overflow-hidden">
        {/* Items */}
        <div className="p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-700 uppercase tracking-wide mb-4">
            <Package className="h-4 w-4" />
            Order Items
          </h2>
          <ul className="divide-y divide-surface-100">
            {items.map((item) => (
              <li key={item.id} className="py-3 flex gap-4">
                <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-surface-100 overflow-hidden">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-surface-300">
                      <ShoppingBag className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900">{item.title}</p>
                  {item.description && (
                    <p className="text-xs text-surface-400 mt-0.5">{item.description}</p>
                  )}
                  <p className="text-xs text-surface-500 mt-1">Qty: {item.quantity}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                  {formatPrice(item.unit_price * item.quantity, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Totals */}
        <div className="border-t border-surface-100 bg-surface-50 px-6 py-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-surface-500">Subtotal</span>
            <span className="tabular-nums">{formatPrice(order.subtotal, currency)}</span>
          </div>
          {order.shipping_total > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-surface-500">Shipping</span>
              <span className="tabular-nums">{formatPrice(order.shipping_total, currency)}</span>
            </div>
          )}
          {order.tax_total > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-surface-500">Tax</span>
              <span className="tabular-nums">{formatPrice(order.tax_total, currency)}</span>
            </div>
          )}
          {order.discount_total > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-surface-500">Discount</span>
              <span className="tabular-nums text-emerald-600">-{formatPrice(order.discount_total, currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold pt-2 border-t border-surface-200">
            <span>Total</span>
            <span className="tabular-nums">{formatPrice(order.total, currency)}</span>
          </div>
        </div>

        {/* Info grid */}
        <div className="border-t border-surface-100 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-surface-100">
          <div className="px-6 py-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-surface-400 uppercase tracking-wide mb-2">
              <Mail className="h-3.5 w-3.5" />
              Contact
            </h3>
            <p className="text-sm text-surface-700 break-all">{order.email}</p>
          </div>
          <div className="px-6 py-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-surface-400 uppercase tracking-wide mb-2">
              <MapPin className="h-3.5 w-3.5" />
              Ship to
            </h3>
            <p className="text-sm text-surface-700">
              {addr.first_name} {addr.last_name}<br />
              {addr.address_1}{addr.address_2 ? `, ${addr.address_2}` : ''}<br />
              {addr.city}, {addr.province} {addr.postal_code}
            </p>
          </div>
          <div className="px-6 py-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-surface-400 uppercase tracking-wide mb-2">
              <CreditCard className="h-3.5 w-3.5" />
              Payment
            </h3>
            <p className="text-sm text-surface-700 capitalize">
              {order.payments?.[0]?.provider_id || 'Manual'}
            </p>
            <p className="text-xs text-surface-400 mt-0.5 capitalize">
              Status: {order.payment_status}
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-10 text-center">
        <Link to="/products" className="btn-primary inline-flex gap-2">
          Continue Shopping
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
