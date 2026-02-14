import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Shield, Eye, EyeOff, ExternalLink } from 'lucide-react';
import * as api from '@/api/medusa';

/**
 * Admin Login Page
 * Authenticates against the Medusa Admin API (/admin/auth).
 * After login, redirects to the built-in Medusa Admin dashboard at /admin.
 */
export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.adminLogin(email, password);
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Invalid admin credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-900">
            <Shield className="h-7 w-7 text-white" />
          </div>
          <h1 className="font-display text-2xl font-bold text-surface-900">Admin Login</h1>
          <p className="mt-1 text-surface-500">Access the store management dashboard</p>
        </div>

        {success ? (
          <div className="rounded-2xl border border-surface-100 bg-white p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <Shield className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="font-display text-lg font-semibold text-surface-900 mb-2">
              Authenticated!
            </h2>
            <p className="text-sm text-surface-500 mb-6">
              You&apos;re now logged in as an admin. Open the Medusa Admin dashboard to manage
              products, orders, and settings.
            </p>
            <a
              href="/admin"
              className="btn-primary inline-flex items-center gap-2"
            >
              Open Admin Dashboard
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">Admin Email</label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="admin@medusa.local"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                {submitting ? 'Authenticating…' : 'Sign in as Admin'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-surface-500">
              Not an admin?{' '}
              <Link to="/login" className="font-medium text-surface-900 hover:underline">
                Customer login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
