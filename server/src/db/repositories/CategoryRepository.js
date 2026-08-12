/**
 * CategoryRepository — abstracts category-related database operations.
 * Uses Prisma Client for type-safe queries.
 *
 * Schema: categories table — id (uuid PK), name (varchar UNIQUE), min_age, max_age.
 */

class CategoryRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async findById(id) {
    return this.prisma.categories.findUnique({ where: { id } });
  }

  async findByName(name) {
    return this.prisma.categories.findUnique({ where: { name } });
  }

  async findAll() {
    return this.prisma.categories.findMany({
      orderBy: [{ min_age: 'asc' }, { max_age: 'asc' }],
    });
  }

  async findByAge(age) {
    return this.prisma.categories.findFirst({
      where: { min_age: { lte: age }, max_age: { gte: age } },
    });
  }

  async create(categoryData) {
    return this.prisma.categories.create({
      data: {
        name: categoryData.name,
        min_age: categoryData.minAge,
        max_age: categoryData.maxAge,
      },
    });
  }

  async update(id, updates) {
    const data = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.minAge !== undefined) data.min_age = updates.minAge;
    if (updates.maxAge !== undefined) data.max_age = updates.maxAge;

    if (Object.keys(data).length === 0) {
      return this.findById(id);
    }

    return this.prisma.categories.update({ where: { id }, data });
  }

  async delete(id) {
    await this.prisma.categories.delete({ where: { id } });
  }

  async countPlayers(categoryId) {
    return this.prisma.players.count({ where: { category_id: categoryId } });
  }
}

module.exports = CategoryRepository;
