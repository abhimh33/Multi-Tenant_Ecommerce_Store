'use strict';

const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const auditService = require('../services/auditService');
const { validate, auditQuerySchema } = require('../middleware/validators');

// GET /api/v1/audit  — global audit log (admin sees all, tenant sees own stores)
router.get(
  '/',
  authenticateToken,
  validate(auditQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, offset, storeId, eventType } = req.query;
      const isAdmin = req.user.role === 'admin';

      const result = await auditService.listAll({
        ownerId: isAdmin ? undefined : req.user.id,
        storeId,
        eventType,
        limit: parseInt(limit, 10) || 100,
        offset: parseInt(offset, 10) || 0,
      });

      res.json({
        requestId: req.requestId,
        logs: result.logs,
        total: result.total,
        limit: parseInt(limit, 10) || 100,
        offset: parseInt(offset, 10) || 0,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
