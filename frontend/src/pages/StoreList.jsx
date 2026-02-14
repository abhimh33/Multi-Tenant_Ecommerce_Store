import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { storesApi } from '../services/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Plus, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import { formatDate, formatDuration } from '../lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';

const STATUS_VARIANTS = {
  requested: 'info',
  provisioning: 'warning',
  ready: 'success',
  failed: 'destructive',
  deleting: 'warning',
  deleted: 'secondary',
};

export default function StoreList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') || '';

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['stores', statusFilter],
    queryFn: () => storesApi.list({ status: statusFilter || undefined, limit: 100 }),
    select: (res) => res.data,
    refetchInterval: 10_000,
  });

  const stores = data?.stores || [];

  const statuses = ['', 'requested', 'provisioning', 'ready', 'failed', 'deleting', 'deleted'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stores</h1>
          <p className="text-muted-foreground">
            {data?.total ?? '...'} store{data?.total !== 1 ? 's' : ''} total
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => navigate('/stores/new')}>
            <Plus className="h-4 w-4 mr-2" />
            New Store
          </Button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => (
          <Button
            key={s || 'all'}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              if (s) {
                setSearchParams({ status: s });
              } else {
                setSearchParams({});
              }
            }}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : stores.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">No stores found.</p>
              <Button className="mt-4" onClick={() => navigate('/stores/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Create your first store
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead className="hidden md:table-cell">Duration</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((store) => (
                  <TableRow
                    key={store.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/stores/${store.id}`)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{store.name}</p>
                        <p className="text-xs text-muted-foreground">{store.id}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={STATUS_VARIANTS[store.status]}>{store.status}</Badge>
                        {store.status === 'failed' && store.failureReason && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-xs">
                                <p className="text-xs">{store.failureReason}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline">{store.engine}</Badge>
                        {store.theme && (
                          <Badge variant="secondary" className="text-[10px]">{store.theme}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDuration(store.provisioningDurationMs)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                      {formatDate(store.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {store.urls?.storefront && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(store.urls.storefront, '_blank');
                          }}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
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
