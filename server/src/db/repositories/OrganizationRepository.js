/**
 * OrganizationRepository — abstracts organization-related database operations.
 * Uses Prisma Client for type-safe queries.
 *
 * Schema: organizations table — id (uuid PK), name (varchar), status, created_at, updated_at.
 */

class OrganizationRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async findById(id) {
    return await this.prisma.organizations.findUnique({
      where: { id },
      include: {
        users: {
          where: { role: 'ORG_ADMIN' },
          select: {
            id: true,
            username: true,
            role: true,
            status: true,
            created_at: true
          }
        }
      }
    });
  }

  async findByName(name) {
    return await this.prisma.organizations.findFirst({
      where: { name }
    });
  }

  async findAll() {
    return await this.prisma.organizations.findMany({
      include: {
        _count: {
          select: { users: true }
        }
      },
      orderBy: { created_at: 'desc' }
    });
  }

  async create({ name }) {
    return await this.prisma.organizations.create({
      data: {
        name,
        status: 'ACTIVE'
      }
    });
  }

  async updateStatus(id, status) {
    return await this.prisma.organizations.update({
      where: { id },
      data: { status }
    });
  }

  async delete(id) {
    return await this.prisma.organizations.delete({
      where: { id }
    });
  }
}

module.exports = OrganizationRepository;
