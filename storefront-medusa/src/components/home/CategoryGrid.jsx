import { Link } from 'react-router-dom';
import { useStore } from '@/context/StoreContext';
import { Layers, Tag, Sparkles, Shirt, Watch, Gem } from 'lucide-react';

const CATEGORY_ICONS = [Layers, Tag, Sparkles, Shirt, Watch, Gem];
const CATEGORY_COLORS = [
  'from-blue-500/10 to-blue-600/5 text-blue-600',
  'from-purple-500/10 to-purple-600/5 text-purple-600',
  'from-amber-500/10 to-amber-600/5 text-amber-600',
  'from-emerald-500/10 to-emerald-600/5 text-emerald-600',
  'from-rose-500/10 to-rose-600/5 text-rose-600',
  'from-cyan-500/10 to-cyan-600/5 text-cyan-600',
];

export default function CategoryGrid() {
  const { collections, loading } = useStore();

  if (loading) {
    return (
      <section className="py-20 bg-surface-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="skeleton h-8 w-48 rounded mb-10" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (!collections.length) return null;

  return (
    <section className="py-20 bg-surface-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="text-sm font-semibold text-brand-600 mb-1">Collections</p>
          <h2 className="font-display text-3xl font-bold tracking-tight text-surface-900">
            Shop by Collection
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {collections.slice(0, 6).map((col, i) => {
            const Icon = CATEGORY_ICONS[i % CATEGORY_ICONS.length];
            const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];

            return (
              <Link
                key={col.id}
                to={`/products?collection=${col.id}`}
                className="group card p-6 flex items-center gap-4 hover:border-surface-300 transition-all"
              >
                <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center
                                transition-transform duration-200 group-hover:scale-110`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-surface-900 truncate">{col.title}</h3>
                  <p className="text-xs text-surface-500 mt-0.5">Explore →</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
