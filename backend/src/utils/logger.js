'use strict';

const { createLogger, format, transports } = require('winston');
const config = require('../config');

/**
 * Structured JSON logger for the control plane.
 * Every log entry includes a timestamp, level, message, and optional metadata.
 * Designed for machine parsing (GenAI/observability) and human readability.
 */
const logger = createLogger({
  level: config.logging.level,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    format.errors({ stack: true }),
    config.isDev
      ? format.combine(format.colorize(), format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        }))
      : format.json()
  ),
  defaultMeta: { service: 'mt-ecommerce-control-plane' },
  transports: [
    new transports.Console(),
  ],
  exitOnError: false,
});

/**
 * Create a child logger scoped to a specific component/domain.
 * @param {string} component - e.g. 'provisioner', 'helm', 'kubernetes'
 * @returns {import('winston').Logger}
 */
logger.child = (component) => {
  return createLogger({
    level: config.logging.level,
    format: logger.format,
    defaultMeta: { service: 'mt-ecommerce-control-plane', component },
    transports: logger.transports,
    exitOnError: false,
  });
};

module.exports = logger;
