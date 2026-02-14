import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, UserPlus, Eye, EyeOff } from 'lucide-react';
import { useCustomer } from '@/context/CustomerContext';

export default function Register() {
  const { register, isLoggedIn } = useCustomer();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    phone: '',
  });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isLoggedIn) {
    navigate('/account', { replace: true });
    return null;
  }

  function update(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await register(form);
      navigate('/account', { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed. The email may already be in use.');
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
            <UserPlus className="h-7 w-7 text-white" />
          </div>
          <h1 className="font-display text-2xl font-bold text-surface-900">Create account</h1>
          <p className="mt-1 text-surface-500">Join us for a better shopping experience</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">First name</label>
              <input
                name="first_name"
                required
                autoFocus
                value={form.first_name}
                onChange={update}
                className="input-field"
                placeholder="Jane"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">Last name</label>
              <input
                name="last_name"
                required
                value={form.last_name}
                onChange={update}
                className="input-field"
                placeholder="Doe"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Email</label>
            <input
              type="email"
              name="email"
              required
              value={form.email}
              onChange={update}
              className="input-field"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Phone (optional)</label>
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={update}
              className="input-field"
              placeholder="+1 (555) 000-0000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                name="password"
                required
                minLength={6}
                value={form.password}
                onChange={update}
                className="input-field pr-10"
                placeholder="Min. 6 characters"
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
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-surface-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-surface-900 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
