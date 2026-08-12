/**
 * Prisma Client singleton.
 * Used as the ORM layer alongside node-pg-migrate (which handles schema migrations).
 */

const { PrismaClient } = require('@prisma/client');

let _prisma = null;

/**
 * Get or create the shared PrismaClient instance.
 * @returns {PrismaClient}
 */
function getPrisma() {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

/**
 * Disconnect Prisma Client (for graceful shutdown).
 */
async function disconnectPrisma() {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}

module.exports = { getPrisma, disconnectPrisma };
