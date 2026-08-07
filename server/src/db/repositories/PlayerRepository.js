/**
 * PlayerRepository — abstracts player-related database operations.
 * Uses Prisma Client for type-safe queries.
 *
 * Schema: players table with UUID PK, competition_id FK, user_id FK,
 * category_id FK, name, school, province, age.
 */

class PlayerRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.players.findUnique({ where: { id } });
  }

  async findByUserId(userId) {
    return this.prisma.players.findFirst({ where: { user_id: userId } });
  }

  async findByCompetition(competitionId) {
    return this.prisma.players.findMany({
      where: { competition_id: competitionId },
      include: {
        categories: { select: { name: true } },
        users: { select: { username: true, role: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async findByCompetitionAndCategory(competitionId, categoryId) {
    return this.prisma.players.findMany({
      where: { competition_id: competitionId, category_id: categoryId },
      include: {
        categories: { select: { name: true } },
        users: { select: { username: true, role: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async create(playerData) {
    const player = await this.prisma.players.create({
      data: {
        competition_id: playerData.competitionId,
        user_id: playerData.userId || null,
        name: playerData.name,
        school: playerData.school || null,
        province: playerData.province || null,
        age: playerData.age || null,
        category_id: playerData.categoryId || null,
      },
    });
    return player;
  }

  async update(id, updates) {
    const data = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.school !== undefined) data.school = updates.school;
    if (updates.province !== undefined) data.province = updates.province;
    if (updates.age !== undefined) data.age = updates.age;
    if (updates.categoryId !== undefined) data.category_id = updates.categoryId;

    if (Object.keys(data).length === 0) {
      return this.findById(id);
    }

    return this.prisma.players.update({ where: { id }, data });
  }

  async delete(id) {
    await this.prisma.players.delete({ where: { id } });
  }

  async deleteByCompetition(competitionId) {
    const result = await this.prisma.players.deleteMany({
      where: { competition_id: competitionId },
    });
    return result.count;
  }

  async countByCompetition(competitionId) {
    return this.prisma.players.count({ where: { competition_id: competitionId } });
  }

  async countByCompetitionAndCategory(competitionId, categoryId) {
    return this.prisma.players.count({
      where: { competition_id: competitionId, category_id: categoryId },
    });
  }
}

module.exports = PlayerRepository;
