import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes with conflict resolution */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Format price in cents to display string */
export function formatPrice(amount, currencyCode = 'usd') {
  if (amount == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

/** Get the cheapest variant price for a product */
export function getProductPrice(product) {
  if (!product?.variants?.length) return null;
  const prices = product.variants
    .flatMap((v) => v.prices || [])
    .map((p) => p.amount)
    .filter(Boolean);
  return prices.length ? Math.min(...prices) : null;
}

/** Get the cheapest variant's currency code */
export function getProductCurrency(product) {
  if (!product?.variants?.length) return 'usd';
  const variant = product.variants[0];
  return variant?.prices?.[0]?.currency_code || 'usd';
}

/** Get the first product image thumbnail URL */
export function getProductThumbnail(product) {
  return product?.thumbnail || product?.images?.[0]?.url || null;
}

/** Truncate text to maxLen chars with ellipsis */
export function truncate(str, maxLen = 100) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen).trim() + '…';
}

/** Generate a product slug from its handle or title */
export function productSlug(product) {
  return product?.handle || product?.id;
}

/** Get the store name from env or fallback */
export function getStoreName() {
  return import.meta.env.VITE_STORE_NAME || 'Store';
}
