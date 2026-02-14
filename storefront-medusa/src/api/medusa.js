/**
 * Medusa Store API v1 client.
 *
 * All requests are plain fetch() calls — no SDK dependency.
 * The base URL is read from VITE_MEDUSA_BACKEND_URL at build time,
 * or falls back to '' (same origin — handled by Vite proxy in dev).
 */

const BASE = import.meta.env.VITE_MEDUSA_BACKEND_URL || '';

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };

  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ── Regions ────────────────────────────────── */
export async function listRegions() {
  const { regions } = await request('/store/regions');
  return regions;
}

/* ── Products ───────────────────────────────── */
export async function listProducts(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit)       qs.set('limit', params.limit);
  if (params.offset)      qs.set('offset', params.offset);
  if (params.collection_id) qs.append('collection_id[]', params.collection_id);
  if (params.category_id)   qs.append('category_id[]', params.category_id);
  if (params.q)           qs.set('q', params.q);
  if (params.order)       qs.set('order', params.order);

  const query = qs.toString();
  const { products, count, limit, offset } = await request(
    `/store/products${query ? '?' + query : ''}`
  );
  return { products, count, limit, offset };
}

export async function getProduct(id) {
  const { product } = await request(`/store/products/${id}`);
  return product;
}

/* ── Collections ────────────────────────────── */
export async function listCollections() {
  const { collections } = await request('/store/collections');
  return collections;
}

export async function getCollection(id) {
  const { collection } = await request(`/store/collections/${id}`);
  return collection;
}

/* ── Product Categories ─────────────────────── */
export async function listCategories(params = {}) {
  const qs = new URLSearchParams();
  if (params.parent_category_id) qs.set('parent_category_id', params.parent_category_id);
  const query = qs.toString();
  const { product_categories } = await request(
    `/store/product-categories${query ? '?' + query : ''}`
  );
  return product_categories;
}

/* ── Cart ───────────────────────────────────── */
export async function createCart(regionId) {
  const body = regionId ? { region_id: regionId } : {};
  const { cart } = await request('/store/carts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return cart;
}

export async function getCart(cartId) {
  const { cart } = await request(`/store/carts/${cartId}`);
  return cart;
}

export async function addLineItem(cartId, variantId, quantity = 1) {
  const { cart } = await request(`/store/carts/${cartId}/line-items`, {
    method: 'POST',
    body: JSON.stringify({ variant_id: variantId, quantity }),
  });
  return cart;
}

export async function updateLineItem(cartId, lineId, quantity) {
  const { cart } = await request(`/store/carts/${cartId}/line-items/${lineId}`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
  return cart;
}

export async function removeLineItem(cartId, lineId) {
  const { cart } = await request(`/store/carts/${cartId}/line-items/${lineId}`, {
    method: 'DELETE',
  });
  return cart;
}

export async function updateCart(cartId, data) {
  const { cart } = await request(`/store/carts/${cartId}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return cart;
}

/* ── Shipping ───────────────────────────────── */
export async function listShippingOptions(cartId) {
  const { shipping_options } = await request(
    `/store/shipping-options/${cartId}`
  );
  return shipping_options;
}

export async function addShippingMethod(cartId, optionId) {
  const { cart } = await request(`/store/carts/${cartId}/shipping-methods`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId }),
  });
  return cart;
}

/* ── Payment ────────────────────────────────── */
export async function createPaymentSessions(cartId) {
  const { cart } = await request(`/store/carts/${cartId}/payment-sessions`, {
    method: 'POST',
  });
  return cart;
}

export async function setPaymentSession(cartId, providerId) {
  const { cart } = await request(`/store/carts/${cartId}/payment-session`, {
    method: 'POST',
    body: JSON.stringify({ provider_id: providerId }),
  });
  return cart;
}

/* ── Complete checkout ──────────────────────── */
export async function completeCart(cartId) {
  const data = await request(`/store/carts/${cartId}/complete`, {
    method: 'POST',
  });
  // data.type = 'order' | 'cart' | 'swap'
  return data;
}

/* ── Orders ─────────────────────────────────── */
export async function getOrder(orderId) {
  const { order } = await request(`/store/orders/${orderId}`);
  return order;
}
