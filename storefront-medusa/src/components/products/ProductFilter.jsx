import { cn } from '@/lib/utils';
import { SlidersHorizontal, X } from 'lucide-react';

export default function ProductFilter({
  collections,
  categories,
  activeCollection,
  activeCategory,
  sortBy,
  onCollectionChange,
  onCategoryChange,
  onSortChange,
  onClear,
}) {
  const hasFilters = activeCollection || activeCategory;

  return (
    <div className="space-y-4">
      {/* Sort & filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Sort */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-surface-400" />
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            className="text-sm font-medium text-surface-700 bg-transparent border-none cursor-pointer
                       focus:outline-none focus:ring-0 pr-6"
          >
            <option value="">Relevance</option>
            <option value="created_at">Newest</option>
            <option value="-created_at">Oldest</option>
            <option value="title">A → Z</option>
            <option value="-title">Z → A</option>
          </select>
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700
                       bg-red-50 rounded-full px-3 py-1 transition-colors"
          >
            <X className="h-3 w-3" />
            Clear filters
          </button>
        )}
      </div>

      {/* Collection chips */}
      {collections.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <ChipButton
            active={!activeCollection}
            onClick={() => onCollectionChange(null)}
          >
            All
          </ChipButton>
          {collections.map((col) => (
            <ChipButton
              key={col.id}
              active={activeCollection === col.id}
              onClick={() => onCollectionChange(col.id)}
            >
              {col.title}
            </ChipButton>
          ))}
        </div>
      )}

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <ChipButton
              key={cat.id}
              active={activeCategory === cat.id}
              onClick={() => onCategoryChange(activeCategory === cat.id ? null : cat.id)}
            >
              {cat.name}
            </ChipButton>
          ))}
        </div>
      )}
    </div>
  );
}

function ChipButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-200',
        active
          ? 'bg-surface-900 text-white shadow-sm'
          : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
      )}
    >
      {children}
    </button>
  );
}
