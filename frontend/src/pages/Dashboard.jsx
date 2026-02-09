import { useQuery } from '@tanstack/react-query';
import { storesApi, healthApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Store, CheckCircle, AlertCircle, Loader2, Server, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';

export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const { data: storesData, isLoading: storesLoading } = useQuery({
    queryKey: ['stores', 'dashboard'],
    queryFn: () => storesApi.list({ limit: 100 }),
    select: (res) => res.data,
  });

  const { data: healthData, isLoading: healthLoading } = useQuery({
    queryKey: ['health'],
    queryFn: () => healthApi.check(),
    select: (res) => res.data,
    refetchInterval: 30_000,
  });

  const stores = storesData?.stores || [];
  const ready = stores.filter((s) => s.status === 'ready').length;
  const provisioning = stores.filter((s) => s.status === 'provisioning' || s.status === 'requested').length;
  const failed = stores.filter((s) => s.status === 'failed').length;

  const statCards = [
    {
      title: 'Total Stores',
      value: stores.length,
      icon: Store,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: 'Ready',
      value: ready,
      icon: CheckCircle,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      title: 'Provisioning',
      value: provisioning,
      icon: Loader2,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      title: 'Failed',
      value: failed,
      icon: AlertCircle,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {user?.username}
          {isAdmin && <Badge variant="warning" className="ml-2">Admin</Badge>}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map(({ title, value, icon: Icon, color, bg }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
              <div className={`rounded-md p-2 ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {storesLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick actions & Health */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full justify-start gap-2" onClick={() => navigate('/stores/new')}>
              <Store className="h-4 w-4" />
              Provision New Store
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => navigate('/stores')}>
              <Store className="h-4 w-4" />
              View All Stores
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => navigate('/audit')}>
              <Store className="h-4 w-4" />
              View Audit Log
            </Button>
          </CardContent>
        </Card>

        {/* Health status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Platform Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {healthLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <Database className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-medium">PostgreSQL</span>
                  </div>
                  <Badge variant={healthData?.checks?.database?.status === 'healthy' ? 'success' : 'destructive'}>
                    {healthData?.checks?.database?.status || 'unknown'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-medium">Kubernetes</span>
                  </div>
                  <Badge variant={healthData?.checks?.kubernetes?.status === 'healthy' ? 'success' : 'destructive'}>
                    {healthData?.checks?.kubernetes?.status || 'unknown'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Overall: <span className="font-medium">{healthData?.status || 'unknown'}</span>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent stores */}
      {stores.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Stores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stores.slice(0, 5).map((store) => (
                <div
                  key={store.id}
                  className="flex items-center justify-between rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => navigate(`/stores/${store.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{store.name}</p>
                      <p className="text-xs text-muted-foreground">{store.id}</p>
                    </div>
                  </div>
                  <StatusBadge status={store.status} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const variants = {
    requested: 'info',
    provisioning: 'warning',
    ready: 'success',
    failed: 'destructive',
    deleting: 'warning',
    deleted: 'secondary',
  };

  return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
}
