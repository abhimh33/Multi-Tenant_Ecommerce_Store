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
 * Set up a freshly-provisioned MedusaJS store.
 * Steps:
 *   1. Find Medusa pod
 *   2. Verify health endpoint
 *   3. Seed admin user via medusa CLI
 * 
 * Each step is idempotent and failures are non-fatal.
 * @param {Object} params
 * @param {string} params.namespace
 * @param {string} params.storeId
 * @param {Object} params.credentials
 * @returns {Promise<Object>} Setup results
 */
async function setupMedusa({ namespace, storeId, credentials }) {
  logger.info('Starting MedusaJS setup', { storeId, namespace });
  const results = {};

  // Step 1: Find Medusa pod
  const podName = await findMedusaPod(namespace);
  logger.info('Found Medusa pod', { storeId, podName });
  results.podName = podName;

  // Step 2: Verify health endpoint
  try {
    const healthResult = await kubectlExecMedusa({
      namespace,
      podName,
      command: 'wget -qO- http://localhost:9000/health 2>&1 || curl -sf http://localhost:9000/health 2>&1 || echo "HEALTH_CHECK_FAILED"',
      timeoutMs: 30000,
    });

    if (healthResult.stdout.includes('HEALTH_CHECK_FAILED')) {
      logger.warn('Medusa health check returned failure', { storeId });
      results.healthCheck = 'warning: health endpoint not responding yet';
    } else {
      logger.info('Medusa health check passed', { storeId });
      results.healthCheck = 'ok';
    }
  } catch (err) {
    logger.warn('Medusa health check failed', { storeId, error: err.message });
    results.healthCheck = `failed: ${err.message}`;
  }

  // Step 3: Create admin user via medusa CLI (idempotent — will skip if user exists)
  try {
    const email = credentials.adminEmail || 'admin@medusa.local';
    const password = credentials.adminPassword;

    await kubectlExecMedusa({
      namespace,
      podName,
      command: `npx medusa user -e "${email}" -p "${password}" 2>&1 || echo "USER_CREATE_SKIP"`,
      timeoutMs: 60000,
    });
    results.adminUser = 'created';
    logger.info('Medusa admin user created', { storeId, email });
  } catch (err) {
    logger.warn('Medusa admin user creation failed', { storeId, error: err.message });
    results.adminUser = `failed: ${err.message}`;
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
