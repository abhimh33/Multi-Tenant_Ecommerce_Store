import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getStoreName } from '@/lib/utils';

export default function Hero() {
  const storeName = getStoreName();

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-surface-900 via-surface-800 to-surface-900">
      {/* Decorative grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h60v60H0z' fill='none'/%3E%3Cpath d='M0 0h1v60H0zM59 0h1v60h-1zM0 0v1h60V0zM0 59v1h60v-1z' fill='white'/%3E%3C/svg%3E")`,
        }}
      />
      {/* Gradient orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px]
                      rounded-full bg-brand-500/20 blur-[120px] pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 sm:py-32 lg:py-40">
        <div className="max-w-2xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/10
                          px-4 py-1.5 text-xs font-medium text-white/80 mb-6 animate-fade-up">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            New collection available
          </div>

          {/* Heading */}
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white
                         leading-[1.1] tracking-tight animate-fade-up"
              style={{ animationDelay: '0.1s' }}>
            Discover products you&apos;ll{' '}
            <span className="bg-gradient-to-r from-brand-400 to-blue-400 bg-clip-text text-transparent">
              love
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mt-6 text-lg text-surface-300 leading-relaxed max-w-lg animate-fade-up"
             style={{ animationDelay: '0.2s' }}>
            Welcome to {storeName}. Explore our curated collection of premium products
            — crafted with care, delivered to your door.
          </p>

          {/* CTA */}
          <div className="mt-8 flex flex-col sm:flex-row gap-4 animate-fade-up"
               style={{ animationDelay: '0.3s' }}>
            <Link to="/products" className="inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3
                       text-sm font-semibold transition-all duration-200 active:scale-[0.98]
                       bg-white text-surface-900 hover:bg-white/80 active:bg-white/60">
              Shop Now
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/collections" className="inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3
                       text-sm font-semibold transition-all duration-200 active:scale-[0.98]
                       bg-transparent border border-white/30 text-white hover:bg-white/10 active:bg-white/20">
              Browse Collections
            </Link>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-16 grid grid-cols-3 gap-8 max-w-md animate-fade-up"
             style={{ animationDelay: '0.4s' }}>
          {[
            ['200+', 'Products'],
            ['Free', 'Shipping'],
            ['24/7', 'Support'],
          ].map(([value, label]) => (
            <div key={label}>
              <p className="font-display text-2xl font-bold text-white">{value}</p>
              <p className="text-sm text-surface-400 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
