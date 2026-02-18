import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { storesApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { Rocket, ArrowLeft, Shield } from 'lucide-react';

const FREE_PLAN_LIMIT = 2;

export default function CreateStore() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [form, setForm] = useState({
    name: '',
    engine: 'woocommerce',
    theme: 'storefront',
    password: '',
  });

  const createMutation = useMutation({
    mutationFn: (data) => {
      // Only send theme for WooCommerce
      const payload = { name: data.name, engine: data.engine };
      if (data.engine === 'woocommerce') {
        payload.theme = data.theme;
      }
      if (data.password) {
        payload.password = data.password;
      }
      return storesApi.create(payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      toast.success(`Store "${res.data.store.name}" is being provisioned!`);
      navigate(`/stores/${res.data.store.id}`);
    },
    onError: (err) => {
      const msg = err.response?.data?.error?.message || 'Failed to create store';
      toast.error(msg);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  // Block admin users from creating stores
  if (isAdmin) {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/stores')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">New Store</h1>
            <p className="text-muted-foreground">Store creation is restricted for admin accounts</p>
          </div>
        </div>
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 mb-3">
              <Shield className="h-6 w-6 text-amber-600" />
            </div>
            <CardTitle>Store Creation Restricted</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              You are logged in as an <span className="font-semibold">administrator</span>. Your role is to
              control and manage tenant stores, not to create stores as a tenant.
              <br /><br />
              If you want to create your own store, please register a separate
              tenant account and sign in with it.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button variant="outline" onClick={() => navigate('/stores')}>
              Back to Stores
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/stores')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Store</h1>
          <p className="text-muted-foreground">Provision a new ecommerce store instance</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Store Configuration</CardTitle>
            <CardDescription>
              {form.engine === 'woocommerce'
                ? 'Launch your online store in minutes — we handle the hosting, database, and infrastructure so you can focus on growing your business.'
                : 'Get your MedusaJS-powered storefront up and running instantly — fully managed infrastructure, ready for you to start selling.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 dark:text-blue-200 dark:bg-blue-950 dark:border-blue-800">
              Free plan allows up to {FREE_PLAN_LIMIT} active stores per account. Need more? Contact the administrator.
            </p>
            <div className="space-y-2">
              <Label htmlFor="name">Store Name</Label>
              <Input
                id="name"
                placeholder="my-awesome-store"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                required
                minLength={3}
                maxLength={63}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only. Must be 3-63 characters.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="engine">Engine</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${form.engine === 'woocommerce'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                    }`}
                  onClick={() => setForm({ ...form, engine: 'woocommerce', theme: 'storefront' })}
                >
                  <span className="text-2xl">🛒</span>
                  <span className="text-sm font-medium">WooCommerce</span>
                  <span className="text-xs text-muted-foreground">WordPress + WooCommerce</span>
                </button>
                <button
                  type="button"
                  className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${form.engine === 'medusa'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                    }`}
                  onClick={() => setForm({ ...form, engine: 'medusa', theme: '' })}
                >
                  <span className="text-2xl">⚡</span>
                  <span className="text-sm font-medium">MedusaJS</span>
                  <span className="text-xs text-muted-foreground">Node.js + PostgreSQL</span>
                </button>
              </div>
            </div>

            {form.engine === 'woocommerce' && (
              <div className="space-y-2">
                <Label>Theme</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className={`flex flex-col items-center gap-3 rounded-lg border-2 p-4 transition-colors ${form.theme === 'storefront'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                      }`}
                    onClick={() => setForm({ ...form, theme: 'storefront' })}
                  >
                    <span className="text-2xl">🏪</span>
                    <span className="text-sm font-medium">Storefront</span>
                    <span className="text-xs text-muted-foreground text-center">Official WooCommerce theme. Clean, flexible, and fully integrated.</span>
                  </button>
                  <button
                    type="button"
                    className={`flex flex-col items-center gap-3 rounded-lg border-2 p-4 transition-colors ${form.theme === 'astra'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                      }`}
                    onClick={() => setForm({ ...form, theme: 'astra' })}
                  >
                    <span className="text-2xl">✨</span>
                    <span className="text-sm font-medium">Astra</span>
                    <span className="text-xs text-muted-foreground text-center">Lightweight and fast. Highly customizable with WooCommerce support.</span>
                  </button>
                </div>
              </div>
            )}
            {(form.engine === 'medusa' || form.engine === 'woocommerce') && (
              <div className="space-y-2">
                <Label htmlFor="password">Admin Password (optional)</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Leave blank for a random password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  minLength={8}
                  maxLength={128}
                />
                <p className="text-xs text-muted-foreground">
                  Set a custom admin password for your store. If blank, a secure random one will be generated. You can view it on the store detail page.
                </p>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => navigate('/stores')}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending} className="gap-2">
              <Rocket className="h-4 w-4" />
              {createMutation.isPending ? 'Provisioning...' : 'Provision Store'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
