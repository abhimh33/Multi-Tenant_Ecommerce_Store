import { Link } from 'react-router-dom';
import { Truck, Shield, RefreshCw } from 'lucide-react';

const PERKS = [
  {
    icon: Truck,
    title: 'Free Shipping',
    description: 'On all orders over $50. Fast delivery to your doorstep.',
  },
  {
    icon: Shield,
    title: 'Secure Payments',
    description: 'Your transactions are protected with industry-grade encryption.',
  },
  {
    icon: RefreshCw,
    title: 'Easy Returns',
    description: '30-day hassle-free return policy. No questions asked.',
  },
];

export default function PromoBar() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {PERKS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex items-start gap-4">
              <div className="h-11 w-11 flex-shrink-0 rounded-xl bg-surface-900 flex items-center justify-center">
                <Icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-surface-900">{title}</h3>
                <p className="text-sm text-surface-500 mt-1 leading-relaxed">{description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA Banner */}
        <div className="mt-16 rounded-3xl bg-gradient-to-r from-surface-900 to-surface-800 p-8 sm:p-12
                        flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="font-display text-2xl font-bold text-white">
              Join our newsletter
            </h3>
            <p className="text-surface-300 mt-2 text-sm">
              Get 10% off your first order and stay up to date.
            </p>
          </div>
          <div className="flex w-full sm:w-auto gap-2">
            <input
              type="email"
              placeholder="you@example.com"
              className="input-field bg-white/10 border-white/10 text-white placeholder:text-white/40
                         focus:border-white/30 focus:ring-white/10 sm:w-64"
            />
            <button className="btn-primary bg-white text-surface-900 hover:bg-surface-100 whitespace-nowrap">
              Subscribe
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
