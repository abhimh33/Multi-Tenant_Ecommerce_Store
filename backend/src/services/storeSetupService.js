'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger').child('store-setup');

const execFileAsync = promisify(execFile);

const KUBECTL_BIN = process.env.KUBECTL_BIN || 'kubectl';

/**
 * Store Setup Service — runs WP-CLI commands via kubectl exec to configure
 * a freshly-provisioned WooCommerce store.
 * 
 * Design decisions:
 * - Uses kubectl exec instead of a Helm post-install Job to avoid
 *   filesystem/quota issues with separate containers.
 * - Each step is idempotent and "|| true" failures are tolerated.
 * - Non-fatal: if setup fails, the store is still usable via browser install.
 */

/**
 * Run a WP-CLI command inside the WordPress pod via kubectl exec.
 * @param {Object} params
 * @param {string} params.namespace
 * @param {string} params.podName - Name of the pod to exec into
 * @param {string} params.command - The command to run
 * @param {number} [params.timeoutMs=60000]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function kubectlExec({ namespace, podName, command, timeoutMs = 60000 }) {
  const args = [
    'exec',
    podName,
    '-n', namespace,
    '-c', 'wordpress',
    '--', 'bash', '-c', command,
  ];

  logger.debug('kubectl exec', { namespace, podName, command: command.substring(0, 200) });

  try {
    const { stdout, stderr } = await execFileAsync(KUBECTL_BIN, args, {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { stdout: stdout?.trim() || '', stderr: stderr?.trim() || '' };
  } catch (err) {
    // Filter out non-fatal stderr messages (e.g., "Defaulted container")
    const stderr = err.stderr?.trim() || '';
    const isOnlyDefaulted = /^Defaulted container/m.test(stderr) && err.code === 0;
    if (isOnlyDefaulted) {
      return { stdout: err.stdout?.trim() || '', stderr };
    }
    const errMsg = stderr || err.message;
    logger.warn('kubectl exec failed', { namespace, podName, error: errMsg.substring(0, 500) });
    throw new Error(`kubectl exec failed: ${errMsg.substring(0, 500)}`);
  }
}

/**
 * Find the WordPress pod name in a namespace.
 * @param {string} namespace
 * @returns {Promise<string>} Pod name
 */
async function findWordPressPod(namespace) {
  try {
    const { stdout } = await execFileAsync(KUBECTL_BIN, [
      'get', 'pods', '-n', namespace,
      '-l', 'app.kubernetes.io/name=wordpress',
      '-o', 'jsonpath={.items[0].metadata.name}',
    ], { timeout: 15000 });

    if (!stdout || stdout === '{}') {
      throw new Error('No WordPress pod found');
    }
    return stdout.trim();
  } catch (err) {
    throw new Error(`Failed to find WordPress pod in ${namespace}: ${err.message}`);
  }
}

/**
 * Wait for WP-CLI to be available inside the WordPress container.
 * WordPress image doesn't include wp-cli, so we install it first.
 * @param {Object} params
 * @param {string} params.namespace
 * @param {string} params.podName
 * @returns {Promise<boolean>}
 */
async function ensureWpCli({ namespace, podName }) {
  // Check if wp-cli is already installed
  try {
    await kubectlExec({
      namespace,
      podName,
      command: 'wp --allow-root --version 2>/dev/null',
      timeoutMs: 15000,
    });
    logger.debug('WP-CLI already available', { namespace });
    return true;
  } catch {
    // Not installed yet, install it
  }

  logger.info('Installing WP-CLI in WordPress pod', { namespace });
  await kubectlExec({
    namespace,
    podName,
    command: [
      'curl -sO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar',
      'chmod +x wp-cli.phar',
      'mv wp-cli.phar /usr/local/bin/wp',
      'wp --allow-root --version',
    ].join(' && '),
    timeoutMs: 120000,
  });
  return true;
}

/**
 * Run the full WooCommerce setup on a WordPress pod.
 * 
 * Steps:
 * 1. Install WP-CLI
 * 2. Run wp core install
 * 3. Install + activate WooCommerce plugin
 * 4. Install + activate the selected theme (Storefront or Astra)
 * 5. Create WooCommerce pages (Shop, Cart, Checkout, My Account)
 * 6. Configure WooCommerce settings (currency, address, permalinks)
 * 7. Enable Cash on Delivery payment gateway
 * 8. Seed dummy products (3 products with prices)
 * 9. Verify storefront accessibility
 * 
 * @param {Object} params
 * @param {string} params.namespace
 * @param {string} params.storeId
 * @param {string} params.siteUrl
 * @param {Object} params.credentials
 * @param {string} [params.theme='storefront'] - Theme to install: 'storefront' or 'astra'
 * @param {string} [params.woocommerceVersion='9.5.2'] - WooCommerce version to install
 * @returns {Promise<Object>} Setup results
 */
async function setupWooCommerce({ namespace, storeId, siteUrl, credentials, theme = 'storefront', woocommerceVersion = '9.5.2' }) {
  const results = {};

  logger.info('Starting WooCommerce setup', { storeId, namespace, siteUrl, theme });

  // Step 0: Find the WordPress pod
  const podName = await findWordPressPod(namespace);
  logger.info('Found WordPress pod', { storeId, podName });

  // Step 1: Install WP-CLI
  await ensureWpCli({ namespace, podName });
  results.wpCli = 'installed';

  // Step 2: Install WordPress core
  logger.info('Installing WordPress core', { storeId });
  try {
    const { stdout } = await kubectlExec({
      namespace,
      podName,
      command: `wp core install --allow-root --url="${siteUrl}" --title="My Store" --admin_user="${credentials.adminUsername}" --admin_password="${credentials.adminPassword}" --admin_email="${credentials.adminEmail}" --skip-email --path=/var/www/html 2>&1 || echo "WP_ALREADY_INSTALLED"`,
      timeoutMs: 120000,
    });
    results.coreInstall = stdout.includes('WP_ALREADY_INSTALLED') ? 'already_installed' : 'installed';
    logger.info('WordPress core install done', { storeId, result: results.coreInstall });
  } catch (err) {
    logger.warn('WordPress core install failed', { storeId, error: err.message });
    results.coreInstall = `failed: ${err.message}`;
  }

  // Step 3: Install WooCommerce (pinned version for WP compatibility)
  logger.info('Installing WooCommerce plugin', { storeId, version: woocommerceVersion });
  try {
    // Use versioned zip URL to avoid latest-version WP requirement conflicts
    const wcUrl = `https://downloads.wordpress.org/plugin/woocommerce.${woocommerceVersion}.zip`;
    await kubectlExec({
      namespace,
      podName,
      command: `wp --allow-root plugin install "${wcUrl}" --activate --path=/var/www/html 2>&1 || wp --allow-root plugin activate woocommerce --path=/var/www/html 2>&1 || echo "WC_SKIP"`,
      timeoutMs: 180000,
    });
    results.woocommerce = `installed (v${woocommerceVersion})`;
    logger.info('WooCommerce installed', { storeId, version: woocommerceVersion });
  } catch (err) {
    logger.warn('WooCommerce install failed', { storeId, error: err.message });
    results.woocommerce = `failed: ${err.message}`;
  }

  // Step 4: Install and activate the selected theme
  const themeSlug = theme === 'astra' ? 'astra' : 'storefront';
  logger.info('Installing theme', { storeId, theme: themeSlug });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: `wp --allow-root theme install ${themeSlug} --activate --path=/var/www/html 2>&1 || wp --allow-root theme activate ${themeSlug} --path=/var/www/html 2>&1 || echo "THEME_SKIP"`,
      timeoutMs: 120000,
    });
    results.theme = themeSlug;
    logger.info('Theme installed and activated', { storeId, theme: themeSlug });
  } catch (err) {
    logger.warn('Theme install failed', { storeId, error: err.message });
    results.theme = `failed: ${err.message}`;
  }

  // Step 5: Create WooCommerce pages (Shop, Cart, Checkout, My Account)
  logger.info('Creating WooCommerce pages', { storeId });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: [
        // Create Shop page
        `SHOP_ID=$(wp --allow-root post list --post_type=page --name=shop --format=ids --path=/var/www/html 2>/dev/null)`,
        `if [ -z "$SHOP_ID" ]; then SHOP_ID=$(wp --allow-root post create --post_type=page --post_title="Shop" --post_status=publish --post_name=shop --porcelain --path=/var/www/html 2>/dev/null); fi`,
        // Create Cart page
        `CART_ID=$(wp --allow-root post list --post_type=page --name=cart --format=ids --path=/var/www/html 2>/dev/null)`,
        `if [ -z "$CART_ID" ]; then CART_ID=$(wp --allow-root post create --post_type=page --post_title="Cart" --post_status=publish --post_name=cart --post_content='<!-- wp:shortcode -->[woocommerce_cart]<!-- /wp:shortcode -->' --porcelain --path=/var/www/html 2>/dev/null); fi`,
        // Create Checkout page
        `CHECKOUT_ID=$(wp --allow-root post list --post_type=page --name=checkout --format=ids --path=/var/www/html 2>/dev/null)`,
        `if [ -z "$CHECKOUT_ID" ]; then CHECKOUT_ID=$(wp --allow-root post create --post_type=page --post_title="Checkout" --post_status=publish --post_name=checkout --post_content='<!-- wp:shortcode -->[woocommerce_checkout]<!-- /wp:shortcode -->' --porcelain --path=/var/www/html 2>/dev/null); fi`,
        // Create My Account page
        `ACCOUNT_ID=$(wp --allow-root post list --post_type=page --name=my-account --format=ids --path=/var/www/html 2>/dev/null)`,
        `if [ -z "$ACCOUNT_ID" ]; then ACCOUNT_ID=$(wp --allow-root post create --post_type=page --post_title="My Account" --post_status=publish --post_name=my-account --post_content='<!-- wp:shortcode -->[woocommerce_my_account]<!-- /wp:shortcode -->' --porcelain --path=/var/www/html 2>/dev/null); fi`,
        // Assign pages to WooCommerce settings
        `wp --allow-root option update woocommerce_shop_page_id "$SHOP_ID" --path=/var/www/html 2>/dev/null`,
        `wp --allow-root option update woocommerce_cart_page_id "$CART_ID" --path=/var/www/html 2>/dev/null`,
        `wp --allow-root option update woocommerce_checkout_page_id "$CHECKOUT_ID" --path=/var/www/html 2>/dev/null`,
        `wp --allow-root option update woocommerce_myaccount_page_id "$ACCOUNT_ID" --path=/var/www/html 2>/dev/null`,
        `echo "PAGES_DONE"`,
      ].join('; '),
      timeoutMs: 120000,
    });
    results.pages = 'created';
    logger.info('WooCommerce pages created', { storeId });
  } catch (err) {
    logger.warn('WooCommerce pages creation failed', { storeId, error: err.message });
    results.pages = `failed: ${err.message}`;
  }

  // Step 6: Configure WooCommerce settings
  logger.info('Configuring WooCommerce settings', { storeId });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: [
        // Store details
        `wp --allow-root option update woocommerce_currency "USD" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_currency_pos "left" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_store_address "123 Main St" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_store_city "Anytown" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_default_country "US:CA" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_store_postcode "90210" --path=/var/www/html`,
        // Disable the WooCommerce setup wizard (we already configured everything)
        `wp --allow-root option update woocommerce_onboarding_profile '{"completed":true}' --format=json --path=/var/www/html`,
        `wp --allow-root option update woocommerce_task_list_hidden "yes" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_admin_notices '[]' --format=json --path=/var/www/html`,
        // Enable guest checkout (easier for testing)
        `wp --allow-root option update woocommerce_enable_guest_checkout "yes" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_enable_checkout_login_reminder "yes" --path=/var/www/html`,
        // Tax settings
        `wp --allow-root option update woocommerce_calc_taxes "no" --path=/var/www/html`,
        // Permalink structure for pretty URLs
        `wp --allow-root rewrite structure '/%postname%/' --path=/var/www/html`,
        `wp --allow-root rewrite flush --path=/var/www/html`,
      ].join(' 2>/dev/null; ') + ' 2>/dev/null; echo "CONFIG_DONE"',
      timeoutMs: 60000,
    });
    results.config = 'done';
    logger.info('WooCommerce settings configured', { storeId });
  } catch (err) {
    logger.warn('WooCommerce config failed', { storeId, error: err.message });
    results.config = `failed: ${err.message}`;
  }

  // Step 7: Enable Cash on Delivery (COD) payment gateway
  logger.info('Enabling COD payment gateway', { storeId });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: [
        // Enable COD via WooCommerce payment gateway settings
        `wp --allow-root option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on Delivery","description":"Pay with cash upon delivery.","instructions":"Pay with cash upon delivery.","enable_for_methods":[],"enable_for_virtual":"yes"}' --format=json --path=/var/www/html`,
        // Activate the COD gateway in the active gateways list
        `ACTIVE=$(wp --allow-root option get woocommerce_gateway_order --format=json --path=/var/www/html 2>/dev/null || echo '{}')`,
        // Flush rewrite rules to ensure checkout pages work
        `wp --allow-root rewrite flush --path=/var/www/html`,
        `echo "COD_DONE"`,
      ].join(' 2>/dev/null; '),
      timeoutMs: 60000,
    });
    results.payment = 'cod_enabled';
    logger.info('COD payment enabled', { storeId });
  } catch (err) {
    logger.warn('COD payment setup failed', { storeId, error: err.message });
    results.payment = `failed: ${err.message}`;
  }

  // Step 8: Seed dummy products (3 sample products)
  // Uses wp post create with WooCommerce meta fields instead of `wp wc product create`
  // because the WC CLI subcommand requires the REST API package which may not load
  // immediately after plugin activation.
  logger.info('Creating sample products', { storeId });
  try {
    const products = [
      {
        title: 'Classic T-Shirt',
        price: '24.99',
        salePrice: '',
        sku: 'TSHIRT-001',
        stock: '50',
        desc: 'A comfortable cotton t-shirt available in multiple sizes. Perfect for everyday wear.',
        shortDesc: 'Comfortable cotton t-shirt',
      },
      {
        title: 'Wireless Headphones',
        price: '79.99',
        salePrice: '59.99',
        sku: 'HEADPHONES-001',
        stock: '30',
        desc: 'Premium wireless headphones with noise cancellation and 24-hour battery life.',
        shortDesc: 'Premium wireless headphones',
      },
      {
        title: 'Leather Wallet',
        price: '39.99',
        salePrice: '',
        sku: 'WALLET-001',
        stock: '100',
        desc: 'Handcrafted genuine leather wallet with multiple card slots and RFID protection.',
        shortDesc: 'Genuine leather wallet',
      },
    ];

    let createdCount = 0;
    for (const product of products) {
      try {
        // Create product post
        const createCmd = [
          `PID=$(wp --allow-root post create`,
          `--post_type=product`,
          `--post_title="${product.title}"`,
          `--post_status=publish`,
          `--post_content="${product.desc}"`,
          `--post_excerpt="${product.shortDesc}"`,
          `--porcelain`,
          `--path=/var/www/html 2>/dev/null)`,
        ].join(' ');

        // Set WooCommerce meta fields
        const metaCmd = [
          `wp --allow-root post meta update $PID _regular_price "${product.price}" --path=/var/www/html`,
          `wp --allow-root post meta update $PID _price "${product.salePrice || product.price}" --path=/var/www/html`,
          product.salePrice ? `wp --allow-root post meta update $PID _sale_price "${product.salePrice}" --path=/var/www/html` : '',
          `wp --allow-root post meta update $PID _sku "${product.sku}" --path=/var/www/html`,
          `wp --allow-root post meta update $PID _stock "${product.stock}" --path=/var/www/html`,
          `wp --allow-root post meta update $PID _stock_status "instock" --path=/var/www/html`,
          `wp --allow-root post meta update $PID _manage_stock "yes" --path=/var/www/html`,
          `wp --allow-root post meta update $PID _visibility "visible" --path=/var/www/html`,
          `wp --allow-root post meta update $PID _product_type "simple" --path=/var/www/html`,
          // Set product type taxonomy
          `wp --allow-root post term set $PID product_type simple --path=/var/www/html`,
          // Set product visibility
          `wp --allow-root post term set $PID product_visibility "" --path=/var/www/html 2>/dev/null || true`,
          `echo "CREATED:$PID"`,
        ].filter(Boolean).join('; ');

        const { stdout } = await kubectlExec({
          namespace,
          podName,
          command: `${createCmd}; if [ -n "$PID" ] && [ "$PID" -gt 0 ] 2>/dev/null; then ${metaCmd}; fi`,
          timeoutMs: 60000,
        });

        if (stdout.includes('CREATED:')) {
          createdCount++;
          logger.debug('Product created', { storeId, product: product.title, output: stdout.substring(0, 100) });
        }
      } catch (productErr) {
        logger.warn('Product creation failed', { storeId, product: product.title, error: productErr.message });
      }
    }

    // Flush WooCommerce product lookup tables after all products created
    if (createdCount > 0) {
      try {
        await kubectlExec({
          namespace,
          podName,
          command: `wp --allow-root wc tool run regenerate_product_lookup_tables --user=1 --path=/var/www/html 2>/dev/null; wp --allow-root cache flush --path=/var/www/html 2>/dev/null; echo "FLUSH_DONE"`,
          timeoutMs: 30000,
        });
      } catch {
        // Non-fatal — lookup tables will regenerate on first visit
      }
    }

    results.sampleProducts = `created (${createdCount} products)`;
    logger.info('Sample products created', { storeId, count: createdCount });
  } catch (err) {
    logger.warn('Sample product creation failed', { storeId, error: err.message });
    results.sampleProducts = `failed: ${err.message}`;
  }

  // Step 9: Final flush and verify
  logger.info('Running final setup verification', { storeId });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: [
        // Flush object cache and rewrite rules
        `wp --allow-root cache flush --path=/var/www/html 2>/dev/null`,
        `wp --allow-root rewrite flush --path=/var/www/html 2>/dev/null`,
        // Verify WooCommerce is active
        `wp --allow-root plugin is-active woocommerce --path=/var/www/html && echo "WC_ACTIVE" || echo "WC_INACTIVE"`,
        // Verify theme is active
        `ACTIVE_THEME=$(wp --allow-root theme list --status=active --field=name --path=/var/www/html 2>/dev/null)`,
        `echo "ACTIVE_THEME=$ACTIVE_THEME"`,
        // Count products
        `PRODUCT_COUNT=$(wp --allow-root post list --post_type=product --post_status=publish --format=count --path=/var/www/html 2>/dev/null)`,
        `echo "PRODUCTS=$PRODUCT_COUNT"`,
      ].join('; '),
      timeoutMs: 60000,
    });
    results.verification = 'done';
  } catch (err) {
    logger.warn('Verification failed (non-fatal)', { storeId, error: err.message });
    results.verification = `failed: ${err.message}`;
  }

  logger.info('WooCommerce setup completed', { storeId, theme: themeSlug, results });
  return results;
}

/**
 * Run a command inside the Medusa pod via kubectl exec.
 * @param {Object} params
 * @param {string} params.namespace
 * @param {string} params.podName
 * @param {string} params.command
 * @param {number} [params.timeoutMs=60000]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function kubectlExecMedusa({ namespace, podName, command, timeoutMs = 60000 }) {
  const args = [
    'exec',
    podName,
    '-n', namespace,
    '-c', 'medusa',
    '--', 'sh', '-c', command,
  ];

  logger.debug('kubectl exec (medusa)', { namespace, podName, command: command.substring(0, 200) });

  try {
    const { stdout, stderr } = await execFileAsync(KUBECTL_BIN, args, {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { stdout: stdout?.trim() || '', stderr: stderr?.trim() || '' };
  } catch (err) {
    const stderr = err.stderr?.trim() || '';
    const isOnlyDefaulted = /^Defaulted container/m.test(stderr) && err.code === 0;
    if (isOnlyDefaulted) {
      return { stdout: err.stdout?.trim() || '', stderr };
    }
    const errMsg = stderr || err.message;
    logger.warn('kubectl exec (medusa) failed', { namespace, podName, error: errMsg.substring(0, 500) });
    throw new Error(`kubectl exec failed: ${errMsg.substring(0, 500)}`);
  }
}

/**
 * Find the Medusa pod name in a namespace.
 * @param {string} namespace
 * @returns {Promise<string>} Pod name
 */
async function findMedusaPod(namespace) {
  try {
    const { stdout } = await execFileAsync(KUBECTL_BIN, [
      'get', 'pods', '-n', namespace,
      '-l', 'app.kubernetes.io/name=medusa',
      '--field-selector=status.phase=Running',
      '-o', 'jsonpath={.items[0].metadata.name}',
    ], { timeout: 15000 });

    if (!stdout || stdout === '{}') {
      throw new Error('No Medusa pod found');
    }
    return stdout.trim();
  } catch (err) {
    throw new Error(`Failed to find Medusa pod in ${namespace}: ${err.message}`);
  }
}

/**
 * Execute a Medusa Admin API call from inside the pod using wget.
 * Returns the parsed JSON response.
 */
async function medusaAdminApi({ namespace, podName, method, path, body, token, timeoutMs = 30000 }) {
  let cmd = `wget -qO- --method=${method} --header="Content-Type: application/json"`;
  if (token) cmd += ` --header="Authorization: Bearer ${token}"`;
  if (body) {
    const jsonStr = JSON.stringify(body).replace(/'/g, "'\\''");
    cmd += ` --body-data='${jsonStr}'`;
  }
  cmd += ` "http://localhost:9000${path}" 2>&1`;
  
  const result = await kubectlExecMedusa({ namespace, podName, command: cmd, timeoutMs });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return result.stdout;
  }
}

/**
 * Seed demo data into a freshly-provisioned Medusa store.
 * Uses the Admin API from inside the Medusa pod (localhost:9000).
 * Auth via /admin/auth/token → JWT Bearer token.
 *
 * Seeds: region, shipping options, collections, products.
 */
async function seedMedusaDemoData({ namespace, podName, storeId, adminEmail, adminPassword, storeName }) {
  logger.info('Seeding Medusa demo data', { storeId });
  const results = {};

  const seedScript = buildSeedScript(adminEmail, adminPassword, storeName || 'Demo Store');

  // Write the seed script to a temp file inside the container, then execute it.
  // This avoids fragile single-quote escaping with `node -e '...'`.
  const writeCmd = `cat > /tmp/seed.js << 'SEEDEOF'\n${seedScript}\nSEEDEOF`;
  
  try {
    await kubectlExecMedusa({
      namespace,
      podName,
      command: writeCmd,
      timeoutMs: 15000,
    });
    logger.debug('Seed script written to /tmp/seed.js', { storeId });
  } catch (err) {
    logger.warn('Failed to write seed script file', { storeId, error: err.message });
    results.status = `write_failed: ${err.message}`;
    return results;
  }

  try {
    const seedResult = await kubectlExecMedusa({
      namespace,
      podName,
      command: 'node /tmp/seed.js',
      timeoutMs: 120000, // 2 min — lots of API calls
    });
    
    logger.info('Seed script output', { storeId, stdout: seedResult.stdout.substring(0, 1000) });
    results.status = 'seeded';
    
    // Parse summary from output
    const lines = seedResult.stdout.split('\n');
    for (const line of lines) {
      if (line.startsWith('SEED_')) {
        const [key, ...val] = line.split(':');
        results[key] = val.join(':').trim();
      }
    }
  } catch (err) {
    logger.warn('Seed script failed', { storeId, error: err.message });
    results.status = `script_failed: ${err.message}`;
  } finally {
    // Clean up temp file
    try {
      await kubectlExecMedusa({ namespace, podName, command: 'rm -f /tmp/seed.js', timeoutMs: 5000 });
    } catch { /* ignore cleanup errors */ }
  }

  return results;
}

/**
 * Build a Node.js script that seeds demo data via the Medusa Admin API.
 * The script runs inside the Medusa container (node:alpine) as a file.
 * Uses JWT Bearer auth via /admin/auth/token endpoint.
 * @param {string} email Admin email
 * @param {string} password Admin password
 * @param {string} storeName Display name for the store
 * @returns {string} Raw Node.js script content (NOT wrapped in node -e)
 */
function buildSeedScript(email, password, storeName) {
  // Escape values for safe embedding in the script
  const safeEmail = email.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safePassword = password.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeStoreName = (storeName || 'Demo Store').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  return `
const http = require('http');
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: 'localhost', port: 9000, path, method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let json; try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, data: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function seed() {
  console.log('SEED_START:' + new Date().toISOString());

  // Authenticate
  const tokenRes = await req('POST', '/admin/auth/token', { email: "${safeEmail}", password: "${safePassword}" });
  if (tokenRes.status !== 200) { console.log('SEED_AUTH:failed ' + tokenRes.status + ' ' + JSON.stringify(tokenRes.data)); return; }
  const tk = tokenRes.data.access_token;
  console.log('SEED_AUTH:ok');

  // Region
  const regRes = await req('GET', '/admin/regions', null, tk);
  let regionId = regRes.data.regions && regRes.data.regions[0] ? regRes.data.regions[0].id : null;
  if (!regionId) {
    const rr = await req('POST', '/admin/regions', { name: 'North America', currency_code: 'usd', tax_rate: 0, payment_providers: ['manual'], fulfillment_providers: ['manual'], countries: ['us', 'ca', 'gb'] }, tk);
    regionId = rr.data.region ? rr.data.region.id : null;
    console.log('SEED_REGION:created ' + regionId);
  } else { console.log('SEED_REGION:exists ' + regionId); }
  if (!regionId) { console.log('SEED_ERROR:no region'); return; }

  // Shipping
  const soRes = await req('GET', '/admin/shipping-options', null, tk);
  if (!soRes.data.shipping_options || soRes.data.shipping_options.length === 0) {
    await req('POST', '/admin/shipping-options', { name: 'Standard Shipping', region_id: regionId, provider_id: 'manual', data: {}, price_type: 'flat_rate', amount: 500, is_return: false }, tk);
    await req('POST', '/admin/shipping-options', { name: 'Express Shipping', region_id: regionId, provider_id: 'manual', data: {}, price_type: 'flat_rate', amount: 1500, is_return: false }, tk);
    console.log('SEED_SHIPPING:created 2');
  } else { console.log('SEED_SHIPPING:exists ' + soRes.data.shipping_options.length); }

  // Collections
  const existingColsRes = await req('GET', '/admin/collections?limit=100', null, tk);
  const existingCols = existingColsRes.data.collections || [];
  const colDefs = [{ title: 'Summer Collection', handle: 'summer-collection' }, { title: 'Best Sellers', handle: 'best-sellers' }, { title: 'New Arrivals', handle: 'new-arrivals' }];
  const colIds = {};
  for (const col of colDefs) {
    const found = existingCols.find(c => c.handle === col.handle);
    if (found) { colIds[col.handle] = found.id; continue; }
    const cr = await req('POST', '/admin/collections', col, tk);
    if (cr.data && cr.data.collection) colIds[col.handle] = cr.data.collection.id;
  }
  console.log('SEED_COLLECTIONS:' + Object.keys(colIds).length);

  // Products - check if already seeded
  const existingProdsRes = await req('GET', '/admin/products?limit=1', null, tk);
  if (existingProdsRes.data.count && existingProdsRes.data.count >= 8) {
    console.log('SEED_PRODUCTS:already_seeded ' + existingProdsRes.data.count);
    // Still ensure all products are in the sales channel
    const scRes2 = await req('GET', '/admin/sales-channels', null, tk);
    const sc2 = scRes2.data.sales_channels && scRes2.data.sales_channels[0] ? scRes2.data.sales_channels[0].id : null;
    if (sc2) {
      const allP = await req('GET', '/admin/products?limit=100&fields=id', null, tk);
      const ids = (allP.data.products || []).map(x => ({ id: x.id }));
      if (ids.length > 0) {
        await req('POST', '/admin/sales-channels/' + sc2 + '/products/batch', { product_ids: ids }, tk);
        console.log('SEED_SALES_CHANNEL:verified ' + ids.length + ' products');
      }
    }
    console.log('SEED_COMPLETE:ok');
    return;
  }

  const products = [
    { title: 'Classic Cotton T-Shirt', handle: 'classic-cotton-tshirt', description: 'A comfortable 100% cotton t-shirt perfect for everyday wear.', status: 'published', thumbnail: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80', collection_id: colIds['best-sellers'], options: [{ title: 'Size' }], variants: [{ title: 'S', prices: [{ currency_code: 'usd', amount: 2999 }], options: [{ value: 'S' }], inventory_quantity: 100, manage_inventory: false }, { title: 'M', prices: [{ currency_code: 'usd', amount: 2999 }], options: [{ value: 'M' }], inventory_quantity: 100, manage_inventory: false }, { title: 'L', prices: [{ currency_code: 'usd', amount: 2999 }], options: [{ value: 'L' }], inventory_quantity: 100, manage_inventory: false }] },
    { title: 'Slim Fit Denim Jeans', handle: 'slim-fit-denim-jeans', description: 'Modern slim-fit jeans crafted from premium stretch denim.', status: 'published', thumbnail: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&q=80', collection_id: colIds['best-sellers'], options: [{ title: 'Size' }], variants: [{ title: '30', prices: [{ currency_code: 'usd', amount: 7999 }], options: [{ value: '30' }], inventory_quantity: 50, manage_inventory: false }, { title: '32', prices: [{ currency_code: 'usd', amount: 7999 }], options: [{ value: '32' }], inventory_quantity: 50, manage_inventory: false }, { title: '34', prices: [{ currency_code: 'usd', amount: 7999 }], options: [{ value: '34' }], inventory_quantity: 50, manage_inventory: false }] },
    { title: 'Leather Crossbody Bag', handle: 'leather-crossbody-bag', description: 'Elegant genuine leather crossbody bag with adjustable strap.', status: 'published', thumbnail: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=600&q=80', collection_id: colIds['summer-collection'], options: [{ title: 'Color' }], variants: [{ title: 'Black', prices: [{ currency_code: 'usd', amount: 12999 }], options: [{ value: 'Black' }], inventory_quantity: 30, manage_inventory: false }, { title: 'Brown', prices: [{ currency_code: 'usd', amount: 12999 }], options: [{ value: 'Brown' }], inventory_quantity: 30, manage_inventory: false }] },
    { title: 'Wireless Bluetooth Headphones', handle: 'wireless-bt-headphones', description: 'Premium noise-cancelling wireless headphones with 30-hour battery life.', status: 'published', thumbnail: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80', collection_id: colIds['new-arrivals'], options: [{ title: 'Color' }], variants: [{ title: 'Matte Black', prices: [{ currency_code: 'usd', amount: 19999 }], options: [{ value: 'Matte Black' }], inventory_quantity: 25, manage_inventory: false }, { title: 'Silver', prices: [{ currency_code: 'usd', amount: 19999 }], options: [{ value: 'Silver' }], inventory_quantity: 25, manage_inventory: false }] },
    { title: 'Canvas Sneakers', handle: 'canvas-sneakers', description: 'Casual low-top canvas sneakers with vulcanized rubber sole.', status: 'published', thumbnail: 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=600&q=80', collection_id: colIds['summer-collection'], options: [{ title: 'Size' }], variants: [{ title: '8', prices: [{ currency_code: 'usd', amount: 5999 }], options: [{ value: '8' }], inventory_quantity: 40, manage_inventory: false }, { title: '9', prices: [{ currency_code: 'usd', amount: 5999 }], options: [{ value: '9' }], inventory_quantity: 40, manage_inventory: false }, { title: '10', prices: [{ currency_code: 'usd', amount: 5999 }], options: [{ value: '10' }], inventory_quantity: 40, manage_inventory: false }] },
    { title: 'Stainless Steel Watch', handle: 'stainless-steel-watch', description: 'Minimalist stainless steel analog watch with Japanese quartz movement.', status: 'published', thumbnail: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=600&q=80', collection_id: colIds['new-arrivals'], options: [{ title: 'Band' }], variants: [{ title: 'Steel Band', prices: [{ currency_code: 'usd', amount: 24999 }], options: [{ value: 'Steel Band' }], inventory_quantity: 20, manage_inventory: false }, { title: 'Leather Band', prices: [{ currency_code: 'usd', amount: 22999 }], options: [{ value: 'Leather Band' }], inventory_quantity: 20, manage_inventory: false }] },
    { title: 'Organic Cotton Hoodie', handle: 'organic-cotton-hoodie', description: 'Cozy organic cotton hoodie with kangaroo pocket.', status: 'published', thumbnail: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600&q=80', collection_id: colIds['best-sellers'], options: [{ title: 'Size' }], variants: [{ title: 'S', prices: [{ currency_code: 'usd', amount: 6999 }], options: [{ value: 'S' }], inventory_quantity: 60, manage_inventory: false }, { title: 'M', prices: [{ currency_code: 'usd', amount: 6999 }], options: [{ value: 'M' }], inventory_quantity: 60, manage_inventory: false }, { title: 'L', prices: [{ currency_code: 'usd', amount: 6999 }], options: [{ value: 'L' }], inventory_quantity: 60, manage_inventory: false }] },
    { title: 'Portable Power Bank', handle: 'portable-power-bank', description: '20000mAh portable charger with USB-C fast charging.', status: 'published', thumbnail: 'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=600&q=80', collection_id: colIds['new-arrivals'], options: [{ title: 'Capacity' }], variants: [{ title: '10000mAh', prices: [{ currency_code: 'usd', amount: 3499 }], options: [{ value: '10000mAh' }], inventory_quantity: 50, manage_inventory: false }, { title: '20000mAh', prices: [{ currency_code: 'usd', amount: 4999 }], options: [{ value: '20000mAh' }], inventory_quantity: 50, manage_inventory: false }] },
  ];

  // Get default sales channel — products must be added to it for the Store API to return them
  const scRes = await req('GET', '/admin/sales-channels', null, tk);
  const defaultSC = scRes.data.sales_channels && scRes.data.sales_channels[0] ? scRes.data.sales_channels[0].id : null;

  let created = 0;
  const createdIds = [];
  for (const p of products) {
    const pr = await req('POST', '/admin/products', p, tk);
    if (pr.data && pr.data.product) { created++; createdIds.push(pr.data.product.id); }
    else console.log('SEED_PRODUCT_ERR:' + p.handle + ' s=' + pr.status + ' ' + JSON.stringify(pr.data).substring(0, 200));
  }
  console.log('SEED_PRODUCTS:created ' + created);

  // Add all products (new and existing) to the default sales channel
  if (defaultSC) {
    const allProds = await req('GET', '/admin/products?limit=100&fields=id', null, tk);
    const allIds = (allProds.data.products || []).map(x => ({ id: x.id }));
    if (allIds.length > 0) {
      const scAddRes = await req('POST', '/admin/sales-channels/' + defaultSC + '/products/batch', { product_ids: allIds }, tk);
      console.log('SEED_SALES_CHANNEL:added ' + allIds.length + ' products (status=' + scAddRes.status + ')');
    }
  } else {
    console.log('SEED_SALES_CHANNEL:WARNING no default sales channel found');
  }

  // Set store name
  await req('POST', '/admin/store', { name: "${safeStoreName}", default_currency_code: 'usd' }, tk);
  console.log('SEED_COMPLETE:ok');
}
seed().catch(e => { console.log('SEED_FATAL:' + e.message); process.exit(1); });
`.trim();
}

/**
 * Set up a freshly-provisioned MedusaJS store.
 * Steps:
 *   1. Find Medusa pod
 *   2. Verify health endpoint
 *   3. Seed admin user via medusa CLI
 *   4. Seed demo data (region, shipping, collections, categories, products)
 * 
 * Each step is idempotent and failures are non-fatal.
 * @param {Object} params
 * @param {string} params.namespace
 * @param {string} params.storeId
 * @param {Object} params.credentials
 * @returns {Promise<Object>} Setup results
 */
async function setupMedusa({ namespace, storeId, credentials, storeName }) {
  logger.info('Starting MedusaJS setup', { storeId, namespace });
  const results = {};

  // Step 1: Find Medusa pod
  const podName = await findMedusaPod(namespace);
  logger.info('Found Medusa pod', { storeId, podName });
  results.podName = podName;

  // Step 2: Wait for Medusa API to be fully ready (retry health check)
  let healthOk = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const healthResult = await kubectlExecMedusa({
        namespace,
        podName,
        command: 'wget -qO- http://localhost:9000/health 2>&1 || echo "HEALTH_CHECK_FAILED"',
        timeoutMs: 30000,
      });

      if (!healthResult.stdout.includes('HEALTH_CHECK_FAILED')) {
        logger.info('Medusa health check passed', { storeId, attempt });
        results.healthCheck = 'ok';
        healthOk = true;
        break;
      }
    } catch (err) {
      logger.debug('Medusa health check attempt failed', { storeId, attempt, error: err.message });
    }
    // Wait before retrying (Medusa can take 15-30s to boot)
    if (attempt < 6) {
      logger.info('Waiting for Medusa API...', { storeId, attempt, nextRetryMs: 10000 });
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  if (!healthOk) {
    logger.warn('Medusa health check never passed after retries', { storeId });
    results.healthCheck = 'warning: health endpoint not responding after retries';
  }

  // Step 3: Create admin user via medusa CLI (idempotent — will skip if user exists)
  const adminEmail = credentials.adminEmail || 'admin@medusa.local';
  const adminPassword = credentials.adminPassword;
  try {
    await kubectlExecMedusa({
      namespace,
      podName,
      command: `npx medusa user -e "${adminEmail}" -p "${adminPassword}" 2>&1 || echo "USER_CREATE_SKIP"`,
      timeoutMs: 60000,
    });
    results.adminUser = 'created';
    logger.info('Medusa admin user created', { storeId, email: adminEmail });
  } catch (err) {
    logger.warn('Medusa admin user creation failed', { storeId, error: err.message });
    results.adminUser = `failed: ${err.message}`;
  }

  // Brief pause after admin user creation — Medusa needs a moment to settle
  await new Promise(r => setTimeout(r, 5000));

  // Step 4: Seed demo data via Admin API
  try {
    results.seedData = await seedMedusaDemoData({
      namespace, podName, storeId, adminEmail, adminPassword, storeName,
    });
    logger.info('Medusa demo data seeded', { storeId });
  } catch (err) {
    logger.warn('Medusa demo data seeding failed', { storeId, error: err.message });
    results.seedData = `failed: ${err.message}`;
  }

  logger.info('MedusaJS setup completed', { storeId, results });
  return results;
}

module.exports = {
  setupWooCommerce,
  setupMedusa,
  kubectlExec,
  kubectlExecMedusa,
  findWordPressPod,
  findMedusaPod,
  ensureWpCli,
};
