import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../services/api';
import {
  LayoutDashboard,
  Store,
  Plus,
  ScrollText,
  LogOut,
  Menu,
  X,
  ShoppingBag,
  Shield,
  KeyRound,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { cn } from '../lib/utils';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/stores', label: 'Stores', icon: Store },
  { to: '/stores/new', label: 'New Store', icon: Plus },
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
];

function SidebarContent({ onNavigate }) {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [showPwForm, setShowPwForm] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwStatus, setPwStatus] = useState({ loading: false, error: null, success: false });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handlePwChange = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirm) {
      setPwStatus({ loading: false, error: 'New passwords do not match.', success: false });
      return;
    }
    if (pwForm.newPassword.length < 8) {
      setPwStatus({ loading: false, error: 'New password must be at least 8 characters.', success: false });
      return;
    }
    setPwStatus({ loading: true, error: null, success: false });
    try {
      await authApi.changePassword({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setPwStatus({ loading: false, error: null, success: true });
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
      setTimeout(() => { setShowPwForm(false); setPwStatus({ loading: false, error: null, success: false }); }, 2000);
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Failed to change password.';
      setPwStatus({ loading: false, error: msg, success: false });
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5">
        <ShoppingBag className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold tracking-tight">MT Ecommerce</span>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Separator />

      {/* User info */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.username}</p>
            <div className="flex items-center gap-1">
              {isAdmin && <Shield className="h-3 w-3 text-amber-500" />}
              <p className="text-xs text-muted-foreground">{user?.role}</p>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setShowPwForm(!showPwForm)}
        >
          <KeyRound className="h-4 w-4" />
          Change Password
        </Button>
        {showPwForm && (
          <form onSubmit={handlePwChange} className="space-y-2 rounded-md border p-3">
            <input
              type="password"
              placeholder="Current password"
              value={pwForm.currentPassword}
              onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
              className="w-full rounded border px-2 py-1 text-sm"
              required
            />
            <input
              type="password"
              placeholder="New password"
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              className="w-full rounded border px-2 py-1 text-sm"
              required
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={pwForm.confirm}
              onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
              className="w-full rounded border px-2 py-1 text-sm"
              required
            />
            {pwStatus.error && <p className="text-xs text-red-500">{pwStatus.error}</p>}
            {pwStatus.success && <p className="text-xs text-emerald-500">Password changed!</p>}
            <Button type="submit" size="sm" className="w-full" disabled={pwStatus.loading}>
              {pwStatus.loading ? 'Saving…' : 'Save'}
            </Button>
          </form>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-muted/40">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col border-r bg-background">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 w-64 bg-background shadow-lg">
            <SidebarContent onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="flex h-14 items-center gap-4 border-b bg-background px-4 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            <span className="font-semibold">MT Ecommerce</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
