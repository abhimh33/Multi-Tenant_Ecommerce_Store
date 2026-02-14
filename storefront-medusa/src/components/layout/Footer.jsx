import { Link } from 'react-router-dom';
import { getStoreName } from '@/lib/utils';

export default function Footer() {
  const storeName = getStoreName();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-surface-100 bg-surface-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Top section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 py-12">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-lg bg-surface-900 flex items-center justify-center">
                <span className="text-white font-display font-bold text-sm">
                  {storeName.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="font-display font-bold text-lg">{storeName}</span>
            </Link>
            <p className="text-sm text-surface-500 leading-relaxed max-w-xs">
              Curated products, modern shopping experience. Quality meets convenience.
            </p>
          </div>

          {/* Shop */}
          <div>
            <h3 className="text-sm font-semibold text-surface-900 mb-4">Shop</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/products" className="text-sm text-surface-500 hover:text-surface-900 transition-colors">
                  All Products
                </Link>
              </li>
              <li>
                <Link to="/collections" className="text-sm text-surface-500 hover:text-surface-900 transition-colors">
                  Collections
                </Link>
              </li>
            </ul>
          </div>

          {/* Help */}
          <div>
            <h3 className="text-sm font-semibold text-surface-900 mb-4">Help</h3>
            <ul className="space-y-3">
              <li>
                <span className="text-sm text-surface-500">Shipping &amp; Returns</span>
              </li>
              <li>
                <span className="text-sm text-surface-500">Contact Us</span>
              </li>
              <li>
                <span className="text-sm text-surface-500">FAQ</span>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-sm font-semibold text-surface-900 mb-4">Legal</h3>
            <ul className="space-y-3">
              <li>
                <span className="text-sm text-surface-500">Privacy Policy</span>
              </li>
              <li>
                <span className="text-sm text-surface-500">Terms of Service</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-surface-200 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-surface-400">
            &copy; {year} {storeName}. All rights reserved.
          </p>
          <p className="text-xs text-surface-400">
            Powered by MedusaJS
          </p>
        </div>
      </div>
    </footer>
  );
}
