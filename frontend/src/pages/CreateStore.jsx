import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { storesApi } from '../services/api';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { Rocket, ArrowLeft } from 'lucide-react';

export default function CreateStore() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    engine: 'woocommerce',
  });

  const createMutation = useMutation({
    mutationFn: (data) => storesApi.create(data),
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
                ? 'Configure your new store. A dedicated Kubernetes namespace will be created with WordPress, WooCommerce, and a MariaDB database.'
                : 'Configure your new store. A dedicated Kubernetes namespace will be created with MedusaJS and a PostgreSQL database.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                  onClick={() => setForm({ ...form, engine: 'woocommerce' })}
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
                  onClick={() => setForm({ ...form, engine: 'medusa' })}
                >
                  <span className="text-2xl">⚡</span>
                  <span className="text-sm font-medium">MedusaJS</span>
                  <span className="text-xs text-muted-foreground">Node.js + PostgreSQL</span>
                </button>
              </div>
            </div>
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
