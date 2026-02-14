import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Layers3 } from 'lucide-react';
import * as api from '@/api/medusa';

export default function Collections() {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listCollections()
      .then(setCollections)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-surface-900">
            Collections
          </h1>
          <p className="mt-1 text-surface-500">Browse our curated collections</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton h-48 rounded-2xl" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <div className="text-center py-20">
          <div className="mx-auto h-16 w-16 rounded-full bg-surface-100 flex items-center justify-center mb-4">
            <Layers3 className="h-7 w-7 text-surface-400" />
          </div>
          <h2 className="text-lg font-semibold text-surface-700">No collections yet</h2>
          <p className="text-sm text-surface-400 mt-1">Collections will appear here once they&apos;re created.</p>
          <Link to="/products" className="btn-primary inline-flex mt-6">Browse All Products</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {collections.map((col, i) => {
            const colors = [
              'from-brand-600 to-indigo-600',
              'from-emerald-600 to-teal-600',
              'from-amber-500 to-orange-600',
              'from-rose-500 to-pink-600',
              'from-violet-600 to-purple-600',
              'from-cyan-500 to-sky-600',
            ];
            return (
              <Link
                key={col.id}
                to={`/products?collection=${col.id}`}
                className="group relative overflow-hidden rounded-2xl bg-gradient-to-br p-8 text-white transition-transform hover:scale-[1.02]"
                style={{}}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${colors[i % colors.length]} opacity-90`} />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.15),transparent_60%)]" />
                <div className="relative z-10">
                  <h3 className="font-display text-xl font-bold mb-1">{col.title}</h3>
                  {col.metadata?.description && (
                    <p className="text-sm text-white/80 mb-6">{col.metadata.description}</p>
                  )}
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-white/90 group-hover:gap-2 transition-all">
                    Shop now <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
