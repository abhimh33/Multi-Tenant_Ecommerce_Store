'use strict';

const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger').child('ingress');

const execFileAsync = promisify(execFile);
const KUBECTL_BIN = process.env.KUBECTL_BIN || 'kubectl';

// ─── Port Forward Management ────────────────────────────────────────────────

let portForwardProcess = null;
let portForwardReady = false;
let portForwardRetries = 0;
const MAX_PORT_FORWARD_RETRIES = 10;
const PORT_FORWARD_RETRY_DELAY_MS = 5000;

/**
 * Start kubectl port-forward to the ingress-nginx controller.
 * Runs as a background child process. Auto-restarts on failure.
 * Only starts if AUTO_PORT_FORWARD=true in config.
 */
async function startPortForward() {
  if (!config.store.autoPortForward) {
    logger.debug('Auto port-forward disabled (set AUTO_PORT_FORWARD=true to enable)');
    return;
  }

  const ingressPort = config.store.ingressPort;
  if (ingressPort === 80) {
    logger.info('Ingress port is 80 — skipping port-forward (assumes native LoadBalancer/NodePort)');
    return;
  }

  // Check if the port is already in use
  try {
    const net = require('net');
    const inUse = await new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(true))
        .once('listening', () => { tester.close(); resolve(false); })
        .listen(ingressPort, '127.0.0.1');
    });
    if (inUse) {
      logger.info(`Port ${ingressPort} already in use — assuming port-forward is already running`);
      portForwardReady = true;
      return;
    }
  } catch {
    // If check fails, try to start anyway
  }

  await launchPortForward();
}

async function launchPortForward() {
  const ingressPort = config.store.ingressPort;

  if (portForwardProcess) {
    try { portForwardProcess.kill(); } catch { /* ignore */ }
    portForwardProcess = null;
    portForwardReady = false;
  }

  logger.info(`Starting port-forward: localhost:${ingressPort} → ingress-nginx:80`);

  const args = [
    'port-forward',
    '-n', 'ingress-nginx',
    'svc/ingress-nginx-controller',
    `${ingressPort}:80`,
    '--address', '127.0.0.1',
  ];

  portForwardProcess = spawn(KUBECTL_BIN, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  portForwardProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('Forwarding from')) {
      portForwardReady = true;
      portForwardRetries = 0;
      logger.info(`Port-forward established: ${msg}`);
    }
  });

  portForwardProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('Handling connection')) {
      logger.warn(`Port-forward stderr: ${msg}`);
    }
  });

  portForwardProcess.on('exit', (code) => {
    portForwardReady = false;
    portForwardProcess = null;

    if (code !== null && code !== 0 && portForwardRetries < MAX_PORT_FORWARD_RETRIES) {
      portForwardRetries++;
      logger.warn(`Port-forward exited (code ${code}), retrying in ${PORT_FORWARD_RETRY_DELAY_MS / 1000}s (attempt ${portForwardRetries}/${MAX_PORT_FORWARD_RETRIES})`);
      setTimeout(() => launchPortForward(), PORT_FORWARD_RETRY_DELAY_MS);
    } else if (portForwardRetries >= MAX_PORT_FORWARD_RETRIES) {
      logger.error(`Port-forward failed after ${MAX_PORT_FORWARD_RETRIES} retries — stores may not be accessible`);
    }
  });

  portForwardProcess.on('error', (err) => {
    logger.error('Port-forward process error', { error: err.message });
    portForwardReady = false;
  });

  // Wait up to 10s for the port-forward to become ready
  const deadline = Date.now() + 10000;
  while (!portForwardReady && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
  }

  if (!portForwardReady) {
    logger.warn('Port-forward did not become ready within 10s — will retry in background');
  }
}

/**
 * Stop the port-forward process.
 */
function stopPortForward() {
  if (portForwardProcess) {
    portForwardRetries = MAX_PORT_FORWARD_RETRIES; // Prevent restart
    try { portForwardProcess.kill(); } catch { /* ignore */ }
    portForwardProcess = null;
    portForwardReady = false;
    logger.info('Port-forward stopped');
  }
}

/**
 * Check if port-forward is ready.
 * @returns {boolean}
 */
function isPortForwardReady() {
  return portForwardReady || !config.store.autoPortForward || config.store.ingressPort === 80;
}

// ─── Hosts File Management ──────────────────────────────────────────────────

const HOSTS_FILE = process.platform === 'win32'
  ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  : '/etc/hosts';

const HOSTS_MARKER_START = '# --- MTEC Stores Start ---';
const HOSTS_MARKER_END = '# --- MTEC Stores End ---';

/**
 * Add a hostname to the system hosts file.
 * Maps it to 127.0.0.1 for local development.
 * 
 * @param {string} hostname - e.g. "store-abc123.localhost"
 * @returns {Promise<boolean>} true if added, false if already exists or failed
 */
async function addHostsEntry(hostname) {
  if (!config.store.autoHostsFile) {
    logger.debug('Auto hosts file management disabled');
    return false;
  }

  // On modern systems, .localhost domains resolve to 127.0.0.1 automatically
  // But Windows may not always do this, so we add explicitly
  if (config.store.domainSuffix !== '.localhost' && !config.isDev) {
    logger.debug('Skipping hosts entry for non-localhost domain');
    return false;
  }

  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, 'utf8');
    
    // Check if entry already exists
    if (hostsContent.includes(hostname)) {
      logger.debug(`Hosts entry already exists: ${hostname}`);
      return true;
    }

    // Build the new entry
    const entry = `127.0.0.1  ${hostname}`;

    // Try to add within MTEC markers
    if (hostsContent.includes(HOSTS_MARKER_START)) {
      const updated = hostsContent.replace(
        HOSTS_MARKER_END,
        `${entry}\n${HOSTS_MARKER_END}`
      );
      await writeHostsFile(updated);
    } else {
      // Add markers + entry at end
      const addition = `\n${HOSTS_MARKER_START}\n${entry}\n${HOSTS_MARKER_END}\n`;
      await writeHostsFile(hostsContent + addition);
    }

    logger.info(`Added hosts entry: ${hostname}`);
    return true;
  } catch (err) {
    // Do NOT escalate to admin privileges — it triggers Windows UAC popups.
    // .localhost domains resolve to 127.0.0.1 automatically on modern systems.
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      logger.debug(`Hosts file write requires admin privileges (skipped to avoid UAC popup): ${hostname}`);
      logger.debug('.localhost subdomains resolve to 127.0.0.1 automatically — hosts entry not required');
      return false;
    }
    logger.debug(`Hosts entry not added for ${hostname}: ${err.message} (non-fatal)`);
    return false;
  }
}

/**
 * Write hosts file content directly.
 */
async function writeHostsFile(content) {
  fs.writeFileSync(HOSTS_FILE, content, 'utf8');
}

// No elevated privilege escalation — .localhost domains resolve automatically.
// This avoids Windows UAC popups during store provisioning.

/**
 * Remove a hostname from the system hosts file.
 * @param {string} hostname
 * @returns {Promise<boolean>}
 */
async function removeHostsEntry(hostname) {
  if (!config.store.autoHostsFile) return false;

  try {
    const content = fs.readFileSync(HOSTS_FILE, 'utf8');
    if (!content.includes(hostname)) return true;

    const lines = content.split('\n');
    const filtered = lines.filter(line => !line.includes(hostname));
    const updated = filtered.join('\n');

    try {
      fs.writeFileSync(HOSTS_FILE, updated, 'utf8');
    } catch {
      // Skip if no permission — avoid UAC popups
      logger.debug(`Cannot remove hosts entry for ${hostname} (no write permission, non-fatal)`);
      return false;
    }

    logger.info(`Removed hosts entry: ${hostname}`);
    return true;
  } catch (err) {
    logger.warn(`Failed to remove hosts entry for ${hostname}: ${err.message}`);
    return false;
  }
}

module.exports = {
  startPortForward,
  stopPortForward,
  isPortForwardReady,
  addHostsEntry,
  removeHostsEntry,
};
