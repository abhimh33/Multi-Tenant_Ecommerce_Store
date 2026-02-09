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
 * 4. Install Storefront theme
 * 5. Configure WooCommerce settings (currency, COD payment)
 * 6. Create a sample product
 * 
 * @param {Object} params
 * @param {string} params.namespace
 * @param {string} params.storeId
 * @param {string} params.siteUrl
 * @param {Object} params.credentials
 * @returns {Promise<Object>} Setup results
 */
async function setupWooCommerce({ namespace, storeId, siteUrl, credentials }) {
  const results = {};

  logger.info('Starting WooCommerce setup', { storeId, namespace, siteUrl });

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

  // Step 3: Install WooCommerce
  logger.info('Installing WooCommerce plugin', { storeId });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: `wp --allow-root plugin install woocommerce --activate --path=/var/www/html 2>&1 || wp --allow-root plugin activate woocommerce --path=/var/www/html 2>&1 || echo "WC_SKIP"`,
      timeoutMs: 180000,
    });
    results.woocommerce = 'installed';
    logger.info('WooCommerce installed', { storeId });
  } catch (err) {
    logger.warn('WooCommerce install failed', { storeId, error: err.message });
    results.woocommerce = `failed: ${err.message}`;
  }

  // Step 4: Install Storefront theme
  logger.info('Installing Storefront theme', { storeId });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: `wp --allow-root theme install storefront --activate --path=/var/www/html 2>&1 || wp --allow-root theme activate storefront --path=/var/www/html 2>&1 || echo "THEME_SKIP"`,
      timeoutMs: 120000,
    });
    results.theme = 'storefront';
    logger.info('Storefront theme installed', { storeId });
  } catch (err) {
    logger.warn('Storefront install failed', { storeId, error: err.message });
    results.theme = `failed: ${err.message}`;
  }

  // Step 5: Configure WooCommerce
  logger.info('Configuring WooCommerce settings', { storeId });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: [
        `wp --allow-root option update woocommerce_currency "USD" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_store_address "123 Main St" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_store_city "Anytown" --path=/var/www/html`,
        `wp --allow-root option update woocommerce_default_country "US:CA" --path=/var/www/html`,
        // Enable COD payment
        `wp --allow-root option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on Delivery","description":"Pay with cash upon delivery."}' --format=json --path=/var/www/html`,
        // Permalink structure
        `wp --allow-root rewrite structure '/%postname%/' --path=/var/www/html`,
        `wp --allow-root rewrite flush --path=/var/www/html`,
      ].join(' 2>/dev/null; ') + ' 2>/dev/null; echo "CONFIG_DONE"',
      timeoutMs: 60000,
    });
    results.config = 'done';
  } catch (err) {
    logger.warn('WooCommerce config failed', { storeId, error: err.message });
    results.config = `failed: ${err.message}`;
  }

  // Step 6: Create sample product
  logger.info('Creating sample product', { storeId });
  try {
    await kubectlExec({
      namespace,
      podName,
      command: `wp --allow-root wc product create --user=1 --name="Sample Product" --type=simple --regular_price="19.99" --description="A sample product created during store setup." --short_description="Sample product" --status=publish --path=/var/www/html 2>&1 || echo "PRODUCT_SKIP"`,
      timeoutMs: 60000,
    });
    results.sampleProduct = 'created';
  } catch (err) {
    logger.warn('Sample product creation failed', { storeId, error: err.message });
    results.sampleProduct = `failed: ${err.message}`;
  }

  logger.info('WooCommerce setup completed', { storeId, results });
  return results;
}

module.exports = {
  setupWooCommerce,
  kubectlExec,
  findWordPressPod,
  ensureWpCli,
};
