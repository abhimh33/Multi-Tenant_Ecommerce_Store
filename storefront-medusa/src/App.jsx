import { Routes, Route } from 'react-router-dom';
import StoreLayout from '@/components/layout/StoreLayout';
import Home from '@/pages/Home';
import Products from '@/pages/Products';
import ProductDetail from '@/pages/ProductDetail';
import Collections from '@/pages/Collections';
import Checkout from '@/pages/Checkout';
import OrderConfirmation from '@/pages/OrderConfirmation';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Account from '@/pages/Account';

export default function App() {
  return (
    <Routes>
      <Route element={<StoreLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/products" element={<Products />} />
        <Route path="/products/:handle" element={<ProductDetail />} />
        <Route path="/collections" element={<Collections />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order/:id" element={<OrderConfirmation />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={
          <div className="mx-auto max-w-xl py-32 text-center">
            <h1 className="font-display text-5xl font-bold text-surface-900 mb-3">404</h1>
            <p className="text-surface-500">Page not found</p>
          </div>
        } />
      </Route>
    </Routes>
  );
}
