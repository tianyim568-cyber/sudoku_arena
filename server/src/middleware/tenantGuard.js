/**
 * tenantGuard — multi-tenant isolation middleware.
 *
 * Ensures every authenticated request is scoped to the caller's organization.
 * SUPER_ADMIN users bypass tenant checks (platform-wide access).
 *
 * Usage:
 *   const { tenantGuard } = require('../middleware/tenantGuard');
 *
 *   // Basic guard: attaches req.organizationId from JWT (blocks unassigned users)
 *   router.get('/', tenantGuard(), listHandler);
 *
 *   // Resource guard: verifies the resource belongs to the caller's org
 *   router.get('/:id', tenantGuard('competitions'), getHandler);
 *
 *   // Custom lookup for nested resources (rounds → competitions → org)
 *   router.get('/:roundId/puzzles', tenantGuard('puzzles', { via: 'rounds', viaColumn: 'round_id' }), handler);
 *
 *   // Inline custom verifier (most flexible)
 *   router.get('/:id', tenantGuard((id, orgId, db) => customQuery(id, orgId, db)), handler);
 */

const { getConnection } = require('../db/connection');

/**
 * Create tenantGuard middleware.
 *
 * @param {string|Function|null} resource
 *   - string: table name (e.g. 'competitions', 'players')
 *   - Function: custom async (resourceId, orgId, db) => boolean
 *   - null/undefined: org-membership check only
 * @param {object} [options]
 *   - param: route parameter name (defaults to ':id')
 *   - via: parent table name for indirect ownership lookups
 *   - viaColumn: FK column on the parent table linking to the resource (defaults to 'id')
 *   - orgColumn: org column on the parent table (defaults to 'organization_id')
 */
function tenantGuard(resource, options) {
  return async (req, res, next) => {
    try {
      // ── authMiddleware must run first ──
      if (!req.user) {
        return res.status(401).json({ code: 40101, message: '未登录', data: null });
      }

      const { userId, role, organizationId } = req.user;

      // ── SUPER_ADMIN: platform-wide access, no tenant scoping ──
      if (role === 'SUPER_ADMIN') {
        req.organizationId = req.query.organizationId || organizationId || null;
        return next();
      }

      // ── All other roles require an organization ──
      if (!organizationId) {
        return res.status(403).json({
          code: 40301,
          message: '用户未关联任何组织，无法访问',
          data: null,
        });
      }

      req.organizationId = organizationId;

      // ── If no resource table specified, org-membership check is enough ──
      if (!resource) {
        return next();
      }

      // ── Resolve the resource ID from route params or query ──
      const opts = options || {};
      const paramName = opts.param || 'id';
      let resourceId = req.params[paramName] || req.query[paramName];

      if (!resourceId) {
        // No resource ID in request → likely a list/create endpoint, skip check
        return next();
      }

      const { get } = getConnection();

      // ── Custom verifier function ──
      if (typeof resource === 'function') {
        const isOwner = await resource(resourceId, organizationId, get);
        if (!isOwner) {
          return res.status(403).json({
            code: 40302,
            message: '无权访问此资源',
            data: null,
          });
        }
        return next();
      }

      // ── Table-based verification ──
      const tableName = resource;

      let row;
      if (opts.via) {
        // Indirect ownership: resource → parent table → organization
        // e.g. puzzles → rounds → competitions → organization_id
        const viaColumn = opts.viaColumn || 'id';
        const orgColumn = opts.orgColumn || 'organization_id';
        row = await get(
          `SELECT p.${viaColumn}
           FROM ${tableName} p
           JOIN ${opts.via} v ON v.${viaColumn} = p.${viaColumn}
           WHERE p.id = ? AND v.${orgColumn} = ?`,
          [resourceId, organizationId]
        );
      } else {
        // Direct ownership: resource.organization_id
        row = await get(
          `SELECT id FROM ${tableName} WHERE id = ? AND organization_id = ?`,
          [resourceId, organizationId]
        );
      }

      if (!row) {
        return res.status(403).json({
          code: 40302,
          message: '无权访问此资源',
          data: null,
        });
      }

      next();
    } catch (error) {
      console.error('[tenantGuard] Error:', error.message);
      res.status(500).json({ code: 50001, message: '租户验证失败', data: null });
    }
  };
}

module.exports = { tenantGuard };
