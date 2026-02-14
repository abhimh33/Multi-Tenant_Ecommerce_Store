import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Search, Menu, X } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { getStoreName } from '@/lib/utils';

export default function Navbar() {
  const { itemCount, setOpen } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const storeName = getStoreName();

  function handleSearch(e) {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/products?q=${encodeURIComponent(query.trim())}`);
      setSearchOpen(false);
      setQuery('');
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-surface-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Left — Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <div className="h-8 w-8 rounded-lg bg-surface-900 flex items-center justify-center
                            transition-transform duration-200 group-hover:scale-105">
              <span className="text-white font-display font-bold text-sm">
                {storeName.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="font-display font-bold text-lg tracking-tight hidden sm:block">
              {storeName}
            </span>
          </Link>

          {/* Center — Nav links (desktop) */}
          <nav className="hidden md:flex items-center gap-8">
            <Link to="/products" className="text-sm font-medium text-surface-600 hover:text-surface-900 transition-colors">
              Shop
            </Link>
            <Link to="/collections" className="text-sm font-medium text-surface-600 hover:text-surface-900 transition-colors">
              Collections
            </Link>
          </nav>

          {/* Right — Actions */}
          <div className="flex items-center gap-2">
            {/* Search toggle */}
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="btn-ghost p-2"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>

            {/* Cart button */}
            <button
              onClick={() => setOpen(true)}
              className="btn-ghost p-2 relative"
              aria-label="Cart"
            >
              <ShoppingBag className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center
                               rounded-full bg-surface-900 text-[10px] font-bold text-white
                               animate-scale-in">
                  {itemCount > 99 ? '99+' : itemCount}
                </span>
              )}
            </button>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="btn-ghost p-2 md:hidden"
              aria-label="Menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Search bar (collapsible) */}
        {searchOpen && (
          <div className="pb-4 animate-fade-in">
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products..."
                className="input-field pl-10"
              />
            </form>
          </div>
        )}
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-surface-100 bg-white animate-fade-in">
          <nav className="flex flex-col p-4 gap-1">
            <Link
              to="/products"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-4 py-3 text-sm font-medium text-surface-700 hover:bg-surface-50"
            >
              Shop
            </Link>
            <Link
              to="/collections"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-4 py-3 text-sm font-medium text-surface-700 hover:bg-surface-50"
            >
              Collections
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
