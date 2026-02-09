import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { auditApi } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Input } from '../components/ui/input';
import { ScrollText, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { useState } from 'react';

const EVENT_COLORS = {
  STORE_CREATED: 'info',
  STATUS_CHANGE: 'warning',
  PROVISIONING_STARTED: 'info',
  PROVISIONING_COMPLETE: 'success',
  PROVISIONING_FAILED: 'destructive',
  STORE_DELETED: 'secondary',
  STORE_RETRY: 'warning',
  DELETE_STARTED: 'warning',
  DELETE_COMPLETE: 'secondary',
};

const PAGE_SIZE = 25;

export default function AuditLog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [storeFilter, setStoreFilter] = useState(searchParams.get('storeId') || '');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit', storeFilter, page],
    queryFn: () =>
      auditApi.list({
        limit: PAGE_SIZE,
        offset,
        storeId: storeFilter || undefined,
      }),
    select: (res) => res.data,
    refetchInterval: 15_000,
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const goToPage = (p) => {
    const params = {};
    if (storeFilter) params.storeId = storeFilter;
    if (p > 1) params.page = String(p);
    setSearchParams(params);
  };

  const handleFilter = (e) => {
    e.preventDefault();
    const params = {};
    if (storeFilter) params.storeId = storeFilter;
    setSearchParams(params);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ScrollText className="h-8 w-8" />
            Audit Log
          </h1>
          <p className="text-muted-foreground">{total} event{total !== 1 ? 's' : ''} total</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filter */}
      <form onSubmit={handleFilter} className="flex gap-2 max-w-md">
        <Input
          placeholder="Filter by Store ID (e.g. store-abc12345)"
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
        {storeFilter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStoreFilter('');
              setSearchParams({});
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground">No audit events found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead className="hidden md:table-cell">Transition</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{log.storeName || log.storeId}</p>
                        {log.storeName && (
                          <p className="text-xs text-muted-foreground">{log.storeId}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={EVENT_COLORS[log.eventType] || 'outline'} className="text-xs">
                        {log.eventType}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {log.previousStatus && log.newStatus
                        ? `${log.previousStatus} → ${log.newStatus}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate">
                      {log.message || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
