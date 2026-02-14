import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, Loader2, Lock, ShoppingBag } from 'lucide-react';
import * as api from '@/api/medusa';
import { useCart } from '@/context/CartContext';
import { formatPrice } from '@/lib/utils';

const STEPS = ['Information', 'Shipping', 'Payment'];

export default function Checkout() {
  const { cart, setCart, refreshCart, resetCart, itemCount } = useCart();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [shippingOptions, setShippingOptions] = useState([]);
  const [selectedShipping, setSelectedShipping] = useState('');

  // Refresh cart data on checkout mount to ensure it's up-to-date
  useEffect(() => {
    refreshCart();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = useState({
    email: '',
    first_name: '',
    last_name: '',
    address_1: '',
    address_2: '',
    city: '',
    province: '',
    postal_code: '',
    country_code: 'us',
    phone: '',
  });

  const currencyCode = cart?.region?.currency_code || 'usd';

  function updateForm(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  /* ── Step 1 → Step 2: Save address & load shipping ── */
  const handleInformationSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const address = {
        first_name: form.first_name,
        last_name: form.last_name,
        address_1: form.address_1,
        address_2: form.address_2,
        city: form.city,
        province: form.province,
        postal_code: form.postal_code,
        country_code: form.country_code,
        phone: form.phone,
      };
      const updated = await api.updateCart(cart.id, {
        email: form.email,
        shipping_address: address,
        billing_address: address,
      });
      setCart(updated);

      // Load shipping options
      const options = await api.listShippingOptions(cart.id);
      setShippingOptions(options);
      if (options.length) setSelectedShipping(options[0].id);

      setStep(1);
    } catch (err) {
      setError(err.message || 'Failed to save address');
    }
    setSubmitting(false);
  }, [cart, form, setCart]);

  /* ── Step 2 → Step 3: Select shipping & init payment ── */
  const handleShippingSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.addShippingMethod(cart.id, selectedShipping);
      const withPayment = await api.createPaymentSessions(cart.id);
      setCart(withPayment);

      // Auto-select manual payment if available
      const manual = withPayment.payment_sessions?.find((s) => s.provider_id === 'manual');
      if (manual) {
        const selected = await api.setPaymentSession(cart.id, 'manual');
        setCart(selected);
      }

      setStep(2);
    } catch (err) {
      setError(err.message || 'Failed to set shipping');
    }
    setSubmitting(false);
  }, [cart, selectedShipping, setCart]);

  /* ── Step 3: Complete checkout ──────────────── */
  const handleComplete = useCallback(async () => {
    setError('');
    setSubmitting(true);
    try {
      const result = await api.completeCart(cart.id);
      if (result.type === 'order') {
        await resetCart();
        navigate(`/order/${result.data.id}`, { replace: true });
      } else {
        setError('Checkout could not be completed. Please try again.');
      }
    } catch (err) {
      setError(err.message || 'Checkout failed');
    }
    setSubmitting(false);
  }, [cart, navigate, resetCart]);

  if (!cart || itemCount === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <div className="h-16 w-16 rounded-full bg-surface-100 flex items-center justify-center mx-auto mb-4">
          <ShoppingBag className="h-7 w-7 text-surface-400" />
        </div>
        <h2 className="text-xl font-semibold text-surface-700">Your cart is empty</h2>
        <Link to="/products" className="btn-primary mt-6 inline-flex">Continue Shopping</Link>
      </div>
    );
  }

  const items = cart.items || [];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
      {/* Back + Steps */}
      <div className="mb-10">
        <Link to="/products" className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-900 mb-6">
          <ChevronLeft className="h-4 w-4" />
          Continue shopping
        </Link>
        <h1 className="font-display text-3xl font-bold tracking-tight text-surface-900 mb-6">
          Checkout
        </h1>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                ${i < step ? 'bg-emerald-100 text-emerald-700'
                  : i === step ? 'bg-surface-900 text-white'
                  : 'bg-surface-100 text-surface-400'}`}>
                <span className={`h-5 w-5 rounded-full border text-center leading-5 text-[10px]
                  ${i < step ? 'border-emerald-300' : i === step ? 'border-white/30' : 'border-surface-300'}`}>
                  {i + 1}
                </span>
                {label}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px w-8 ${i < step ? 'bg-emerald-300' : 'bg-surface-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* Left — Form */}
        <div className="lg:col-span-2">
          {error && (
            <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Step 0: Information */}
          {step === 0 && (
            <form onSubmit={handleInformationSubmit} className="space-y-5">
              <h2 className="font-semibold text-lg mb-4">Contact Information</h2>
              <input name="email" type="email" required placeholder="Email address"
                className="input-field" value={form.email} onChange={updateForm} />

              <h2 className="font-semibold text-lg mt-8 mb-4">Shipping Address</h2>
              <div className="grid grid-cols-2 gap-4">
                <input name="first_name" required placeholder="First name"
                  className="input-field" value={form.first_name} onChange={updateForm} />
                <input name="last_name" required placeholder="Last name"
                  className="input-field" value={form.last_name} onChange={updateForm} />
              </div>
              <input name="address_1" required placeholder="Address"
                className="input-field" value={form.address_1} onChange={updateForm} />
              <input name="address_2" placeholder="Apartment, suite, etc. (optional)"
                className="input-field" value={form.address_2} onChange={updateForm} />
              <div className="grid grid-cols-3 gap-4">
                <input name="city" required placeholder="City"
                  className="input-field" value={form.city} onChange={updateForm} />
                <input name="province" placeholder="State / Province"
                  className="input-field" value={form.province} onChange={updateForm} />
                <input name="postal_code" required placeholder="ZIP / Postal"
                  className="input-field" value={form.postal_code} onChange={updateForm} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <select name="country_code" className="input-field" value={form.country_code} onChange={updateForm}>
                  <option value="us">United States</option>
                  <option value="ca">Canada</option>
                  <option value="gb">United Kingdom</option>
                  <option value="de">Germany</option>
                  <option value="fr">France</option>
                  <option value="in">India</option>
                </select>
                <input name="phone" placeholder="Phone (optional)"
                  className="input-field" value={form.phone} onChange={updateForm} />
              </div>

              <button type="submit" disabled={submitting} className="btn-primary w-full justify-center mt-6">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue to Shipping'}
              </button>
            </form>
          )}

          {/* Step 1: Shipping */}
          {step === 1 && (
            <form onSubmit={handleShippingSubmit} className="space-y-5">
              <h2 className="font-semibold text-lg mb-4">Shipping Method</h2>

              {shippingOptions.length === 0 ? (
                <p className="text-surface-500 text-sm">No shipping options available for this address.</p>
              ) : (
                <div className="space-y-3">
                  {shippingOptions.map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all
                        ${selectedShipping === opt.id
                          ? 'border-surface-900 bg-surface-50 ring-1 ring-surface-900'
                          : 'border-surface-200 hover:border-surface-400'}`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="shipping"
                          value={opt.id}
                          checked={selectedShipping === opt.id}
                          onChange={() => setSelectedShipping(opt.id)}
                          className="accent-surface-900"
                        />
                        <div>
                          <p className="text-sm font-medium text-surface-900">{opt.name}</p>
                          <p className="text-xs text-surface-500">
                            {opt.data?.estimated_days ? `${opt.data.estimated_days} business days` : 'Standard delivery'}
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {opt.amount === 0 ? 'Free' : formatPrice(opt.amount, currencyCode)}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex gap-4 mt-6">
                <button type="button" onClick={() => setStep(0)} className="btn-secondary flex-1 justify-center">
                  Back
                </button>
                <button type="submit" disabled={submitting || !selectedShipping} className="btn-primary flex-1 justify-center">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue to Payment'}
                </button>
              </div>
            </form>
          )}

          {/* Step 2: Payment */}
          {step === 2 && (
            <div className="space-y-6">
              <h2 className="font-semibold text-lg mb-4">Payment</h2>

              <div className="rounded-xl border border-surface-200 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <Lock className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-medium text-surface-900">Manual Payment</p>
                </div>
                <p className="text-sm text-surface-500">
                  This is a test environment. Your order will be placed using manual payment processing.
                </p>
              </div>

              {/* Order review */}
              <div className="rounded-xl border border-surface-200 p-6">
                <h3 className="text-sm font-semibold text-surface-700 mb-4">Shipping to</h3>
                <p className="text-sm text-surface-600">
                  {form.first_name} {form.last_name}<br />
                  {form.address_1}{form.address_2 ? `, ${form.address_2}` : ''}<br />
                  {form.city}, {form.province} {form.postal_code}<br />
                  {form.country_code.toUpperCase()}
                </p>
              </div>

              <div className="flex gap-4">
                <button type="button" onClick={() => setStep(1)} className="btn-secondary flex-1 justify-center">
                  Back
                </button>
                <button
                  onClick={handleComplete}
                  disabled={submitting}
                  className="btn-primary flex-1 justify-center bg-emerald-600 hover:bg-emerald-700"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <>
                      <Lock className="h-4 w-4" />
                      Place Order
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right — Order Summary */}
        <div className="lg:col-span-1">
          <div className="card rounded-2xl p-6 sticky top-24">
            <h3 className="font-semibold text-surface-900 mb-4">Order Summary</h3>

            {/* Items */}
            <ul className="divide-y divide-surface-100">
              {items.map((item) => (
                <li key={item.id} className="py-3 flex gap-3">
                  <div className="h-14 w-14 flex-shrink-0 rounded-lg bg-surface-100 overflow-hidden">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-surface-300">
                        <ShoppingBag className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-900 truncate">{item.title}</p>
                    <p className="text-xs text-surface-400">Qty: {item.quantity}</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">
                    {formatPrice(item.unit_price * item.quantity, currencyCode)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Totals */}
            <div className="border-t border-surface-100 mt-4 pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Subtotal</span>
                <span className="font-medium tabular-nums">{formatPrice(cart.subtotal, currencyCode)}</span>
              </div>
              {cart.shipping_total > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Shipping</span>
                  <span className="font-medium tabular-nums">{formatPrice(cart.shipping_total, currencyCode)}</span>
                </div>
              )}
              {cart.tax_total > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Tax</span>
                  <span className="font-medium tabular-nums">{formatPrice(cart.tax_total, currencyCode)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold pt-2 border-t border-surface-100">
                <span>Total</span>
                <span className="tabular-nums">{formatPrice(cart.total, currencyCode)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
