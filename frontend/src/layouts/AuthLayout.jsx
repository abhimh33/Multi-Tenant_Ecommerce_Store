import { Outlet } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';

export default function AuthLayout() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <ShoppingBag className="h-8 w-8" />
            <span className="text-2xl font-bold tracking-tight">MT Ecommerce</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Multi-Tenant Store Provisioning Platform
          </p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
