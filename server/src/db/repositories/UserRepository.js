/**
 * User repository — abstracts all user-related database operations.
 * Uses Prisma Client for type-safe queries.
 *
 * Schema: users table with UUID primary keys, organization_id FK,
 * password_hash (bcrypt), role (SUPER_ADMIN/ORG_ADMIN/JUDGE/PLAYER), status.
 */

class UserRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.users.findUnique({
      where: { id },
      select: {
        id: true,
        organization_id: true,
        username: true,
        role: true,
        status: true,
        created_at: true,
      },
    });
  }

  async findByUsername(username) {
    return this.prisma.users.findUnique({ where: { username } });
  }

  async findByUsernameSafe(username) {
    return this.prisma.users.findUnique({
      where: { username },
      select: {
        id: true,
        organization_id: true,
        username: true,
        role: true,
        status: true,
      },
    });
  }

  async findAll() {
    return this.prisma.users.findMany({
      select: {
        id: true,
        organization_id: true,
        username: true,
        role: true,
        status: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async findByRole(role) {
    return this.prisma.users.findMany({ where: { role } });
  }

  async findByOrganization(organizationId) {
    return this.prisma.users.findMany({ where: { organization_id: organizationId } });
  }

  async create({ username, password, role, organizationId }) {
    return this.prisma.users.create({
      data: {
        username,
        password_hash: password,
        role,
        organization_id: organizationId || null,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        organization_id: true,
        username: true,
        role: true,
        status: true,
      },
    });
  }

  async updateStatus(id, status) {
    await this.prisma.users.update({
      where: { id },
      data: { status, updated_at: new Date() },
    });
  }

  async updatePassword(id, passwordHash) {
    await this.prisma.users.update({
      where: { id },
      data: { password_hash: passwordHash, updated_at: new Date() },
    });
  }
}

module.exports = UserRepository;
