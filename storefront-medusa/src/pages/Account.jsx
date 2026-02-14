import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Package, LogOut, Loader2, ChevronRight } from 'lucide-react';
import { useCustomer } from '@/context/CustomerContext';
import * as api from '@/api/medusa';
import { formatPrice } from '@/lib/utils';

export default function Account() {
  const { customer, loading, isLoggedIn, logout } = useCustomer();
  const navigate = useNavigate();
  const [tab, setTab] = useState('profile'); // 'profile' | 'orders'
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  useEffect(() => {
    if (!loading && !isLoggedIn) {
      navigate('/login', { replace: true });
    }
  }, [loading, isLoggedIn, navigate]);

  useEffect(() => {
    if (tab === 'orders' && isLoggedIn) {
      setOrdersLoading(true);
      api.listCustomerOrders({ limit: 20 })
        .then((data) => setOrders(data.orders || []))
        .catch(() => setOrders([]))
        .finally(() => setOrdersLoading(false));
    }
  }, [tab, isLoggedIn]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-surface-400" />
      </div>
    );
  }

  if (!customer) return null;

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-surface-900">My Account</h1>
          <p className="mt-1 text-surface-500">
            Welcome back, {customer.first_name || customer.email}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="btn-ghost text-sm flex items-center gap-2 text-surface-500 hover:text-red-600"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-surface-100">
        <button
          onClick={() => setTab('profile')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'profile'
              ? 'border-surface-900 text-surface-900'
              : 'border-transparent text-surface-500 hover:text-surface-700'
          }`}
        >
          <User className="inline h-4 w-4 mr-1.5 -mt-0.5" />
          Profile
        </button>
        <button
          onClick={() => setTab('orders')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'orders'
              ? 'border-surface-900 text-surface-900'
              : 'border-transparent text-surface-500 hover:text-surface-700'
          }`}
        >
          <Package className="inline h-4 w-4 mr-1.5 -mt-0.5" />
          Orders
        </button>
      </div>

      {/* Profile Tab */}
      {tab === 'profile' && (
        <div className="rounded-2xl border border-surface-100 bg-white">
          <div className="p-6 border-b border-surface-50">
            <h2 className="font-display text-lg font-semibold text-surface-900">Profile details</h2>
          </div>
          <div className="p-6 space-y-4">
            <Row label="Name" value={`${customer.first_name || ''} ${customer.last_name || ''}`.trim() || '—'} />
            <Row label="Email" value={customer.email} />
            <Row label="Phone" value={customer.phone || '—'} />
            <Row label="Member since" value={new Date(customer.created_at).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric'
            })} />
          </div>
        </div>
      )}

      {/* Orders Tab */}
      {tab === 'orders' && (
        <div className="rounded-2xl border border-surface-100 bg-white">
          <div className="p-6 border-b border-surface-50">
            <h2 className="font-display text-lg font-semibold text-surface-900">Order history</h2>
          </div>
          {ordersLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-surface-400" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-16 text-center">
              <Package className="mx-auto h-10 w-10 text-surface-300 mb-3" />
              <p className="text-surface-500">No orders yet</p>
              <Link to="/products" className="btn-primary mt-4 inline-flex">
                Start shopping
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-surface-50">
              {orders.map((order) => (
                <Link
                  key={order.id}
                  to={`/order/${order.id}`}
                  className="flex items-center justify-between p-6 hover:bg-surface-50/50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-surface-900">
                      Order #{order.display_id}
                    </p>
                    <p className="text-sm text-surface-500 mt-0.5">
                      {new Date(order.created_at).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                      {' · '}
                      {order.items?.length || 0} item{(order.items?.length || 0) !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-surface-900">
                      {formatPrice(order.total, order.currency_code)}
                    </span>
                    <OrderStatus status={order.fulfillment_status} />
                    <ChevronRight className="h-4 w-4 text-surface-400" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-surface-500">{label}</span>
      <span className="text-sm font-medium text-surface-900">{value}</span>
    </div>
  );
}

function OrderStatus({ status }) {
  const map = {
    not_fulfilled: { label: 'Processing', cls: 'bg-amber-100 text-amber-700' },
    fulfilled: { label: 'Shipped', cls: 'bg-blue-100 text-blue-700' },
    shipped: { label: 'Shipped', cls: 'bg-blue-100 text-blue-700' },
    returned: { label: 'Returned', cls: 'bg-surface-100 text-surface-600' },
    canceled: { label: 'Canceled', cls: 'bg-red-100 text-red-700' },
  };
  const s = map[status] || { label: status || 'Unknown', cls: 'bg-surface-100 text-surface-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
