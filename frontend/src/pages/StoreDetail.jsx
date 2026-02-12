import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storesApi } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Separator } from '../components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  ArrowLeft,
  ExternalLink,
  Trash2,
  RotateCcw,
  Clock,
  Globe,
  Box,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatDuration } from '../lib/utils';

const STATUS_VARIANTS = {
  requested: 'info',
  provisioning: 'warning',
  ready: 'success',
  failed: 'destructive',
  deleting: 'warning',
  deleted: 'secondary',
};

export default function StoreDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: storeData, isLoading } = useQuery({
    queryKey: ['store', id],
    queryFn: () => storesApi.get(id),
    select: (res) => res.data.store,
    refetchInterval: (query) => {
      const status = query.state?.data?.status;
      return status === 'provisioning' || status === 'requested' || status === 'deleting'
        ? 5000
        : 30000;
    },
  });

  const { data: logsData } = useQuery({
    queryKey: ['store-logs', id],
    queryFn: () => storesApi.getLogs(id, { limit: 50 }),
    select: (res) => res.data,
    refetchInterval: 15_000,
  });

  const deleteMutation = useMutation({
    mutationFn: () => storesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stores'] });
      queryClient.invalidateQueries({ queryKey: ['store', id] });
      toast.success('Store deletion initiated');
      setDeleteOpen(false);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error?.message || 'Delete failed');
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => storesApi.retry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store', id] });
      toast.success('Store retry initiated');
    },
    onError: (err) => {
      toast.error(err.response?.data?.error?.message || 'Retry failed');
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const store = storeData;

  if (!store) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">Store not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/stores')}>
          Back to Stores
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/stores')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{store.name}</h1>
              <Badge variant={STATUS_VARIANTS[store.status]} className="text-sm">
                {store.status}
              </Badge>
            </div>
            <p className="text-muted-foreground">{store.id}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {store.status === 'failed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          )}
          {(store.status === 'ready' || store.status === 'failed') && (
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Store</DialogTitle>
                  <DialogDescription>
                    This will permanently delete the store &quot;{store.name}&quot; and all its data,
                    including the Kubernetes namespace, database, and files.
                    This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete Store'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Store details grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* General info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Box className="h-5 w-5" />
              General
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Engine">
              <Badge variant="outline">
                {store.engine === 'woocommerce' ? '🛒 WooCommerce' : '⚡ MedusaJS'}
              </Badge>
            </InfoRow>
            <InfoRow label="Stack">
              <span className="text-xs text-muted-foreground">
                {store.engine === 'woocommerce' ? 'WordPress + MariaDB' : 'Node.js + PostgreSQL'}
              </span>
            </InfoRow>
            <InfoRow label="Namespace">{store.namespace}</InfoRow>
            <InfoRow label="Retry Count">{store.retryCount}</InfoRow>
            <InfoRow label="Duration">
              {formatDuration(store.provisioningDurationMs)}
            </InfoRow>
          </CardContent>
        </Card>

        {/* URLs & Timing */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Access & Timing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Storefront">
              {store.urls?.storefront ? (
                <a
                  href={store.urls.storefront}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary flex items-center gap-1 hover:underline text-sm"
                >
                  {store.urls.storefront}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-muted-foreground text-sm">—</span>
              )}
            </InfoRow>
            <InfoRow label="Admin">
              {store.urls?.admin ? (
                <a
                  href={store.urls.admin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary flex items-center gap-1 hover:underline text-sm"
                >
                  {store.urls.admin}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-muted-foreground text-sm">—</span>
              )}
            </InfoRow>
            <Separator />
            <InfoRow label="Created">{formatDate(store.createdAt)}</InfoRow>
            <InfoRow label="Updated">{formatDate(store.updatedAt)}</InfoRow>
          </CardContent>
        </Card>
      </div>

      {/* Failure reason */}
      {store.failureReason && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Failure Reason
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-destructive/10 p-3 rounded-md overflow-x-auto whitespace-pre-wrap">
              {store.failureReason}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Audit log */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Activity Log
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {logsData?.total ?? 0} events
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {!logsData?.logs?.length ? (
            <p className="p-6 text-center text-muted-foreground">No events yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="hidden md:table-cell">Transition</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsData.logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{log.eventType}</Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {log.previousStatus && log.newStatus
                        ? `${log.previousStatus} → ${log.newStatus}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate">
                      {log.message || '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}
