/**
 * Schema Verification Test Script
 * Tests the new schema after migrations 037-045
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDB, getRepos } = require('./src/utils/db');

async function testSchema() {
  console.log('=== Schema Verification Test ===\n');

  try {
    await initDB();
    const repos = getRepos();
    const { run, all, get } = require('./src/db/connection').getConnection();

    console.log('1. Testing CategoryRepository...');
    const categories = await repos.categories.findAll();
    console.log(`   Found ${categories.length} categories:`);
    categories.forEach(cat => {
      console.log(`     - ${cat.name}: age ${cat.min_age}-${cat.max_age}`);
    });

    const u6 = await repos.categories.findByName('U6');
    console.log(`   U6 category: ${u6 ? '✓' : '✗'}`);

    const ageMatch = await repos.categories.findByAge(7);
    console.log(`   Age 7 matches: ${ageMatch ? ageMatch.name : 'none'}`);

    console.log('\n2. Testing PlayerRepository...');
    const orgId = 'ae26c95f-e8f6-4058-a513-6251f8b3122f';

    // Create a test competition
    await run(`
      INSERT INTO competitions (id, organization_id, name, status, created_at, updated_at)
      VALUES ('11111111-1111-1111-1111-111111111111', $1, 'Test Competition', 'DRAFT', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `, [orgId]);

    const players = await repos.players.findByCompetition('11111111-1111-1111-1111-111111111111');
    console.log(`   Found ${players.length} players`);

    if (players.length === 0) {
      console.log('   Creating test player...');
      const testPlayer = await repos.players.create({
        competitionId: '11111111-1111-1111-1111-111111111111',
        name: 'Test Player',
        age: 8,
        school: 'Test School',
        province: 'Test Province',
        categoryId: u6?.id || null
      });
      console.log(`   Created: ${testPlayer.name} (${testPlayer.id})`);

      // Verify player was created
      const verifyPlayer = await repos.players.findById(testPlayer.id);
      console.log(`   Player verified: ${verifyPlayer ? '✓' : '✗'}`);
      console.log(`   Player has category_id: ${verifyPlayer.category_id ? '✓' : '✗'}`);
    }

    console.log('\n3. Testing UserRepository (without email)...');
    const users = await repos.users.findAll();
    console.log(`   Found ${users.length} users`);

    if (users.length > 0) {
      const sampleUser = users[0];
      console.log(`   Sample user fields: ${Object.keys(sampleUser).join(', ')}`);
      console.log(`   Has email field: ${'email' in sampleUser ? '✗ (should be removed)' : '✓'}`);
    }

    console.log('\n4. Testing auth login (existing functionality)...');
    const admin = await repos.users.findByUsername('admin');
    if (admin) {
      const validPassword = bcrypt.compareSync('admin123', admin.password_hash);
      console.log(`   Admin login test: ${validPassword ? '✓' : '✗'}`);
    } else {
      console.log('   Admin user not found');
    }

    console.log('\n5. Database schema verification...');
    const conn = require('./src/db/connection');
    const connHelpers = conn.getConnection();

    // Check tables exist
    const tables = await connHelpers.all(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`   Tables: ${tables.map(t => t.table_name).join(', ')}`);

    // Check players table columns
    const playerCols = await connHelpers.all(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'players'
      ORDER BY ordinal_position
    `);
    console.log(`   Players columns: ${playerCols.map(c => c.column_name).join(', ')}`);
    console.log(`   Has category_id: ${playerCols.some(c => c.column_name === 'category_id') ? '✓' : '✗'}`);
    console.log(`   Has email: ${playerCols.some(c => c.column_name === 'email') ? '✗' : '✓ (correctly removed)'}`);

    // Check users table columns
    const userCols = await connHelpers.all(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    console.log(`   Users columns: ${userCols.map(c => c.column_name).join(', ')}`);
    console.log(`   Has email: ${userCols.some(c => c.column_name === 'email') ? '✗ (should be removed)' : '✓'}`);

    // Check competitions table columns
    const compCols = await connHelpers.all(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'competitions'
      ORDER BY ordinal_position
    `);
    console.log(`   Competitions columns: ${compCols.map(c => c.column_name).join(', ')}`);
    console.log(`   Has display_access_token: ${compCols.some(c => c.column_name === 'display_access_token') ? '✓' : '✗'}`);
    console.log(`   Has access_code: ${compCols.some(c => c.column_name === 'access_code') ? '✗' : '✓ (correctly removed)'}`);

    // Check final_rankings table structure
    const finalCols = await connHelpers.all(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'final_rankings'
      ORDER BY ordinal_position
    `);
    console.log(`   Final rankings columns: ${finalCols.map(c => c.column_name).join(', ')}`);
    console.log(`   Has competition_stage_id: ${finalCols.some(c => c.column_name === 'competition_stage_id') ? '✓' : '✗'}`);
    console.log(`   Has entity_type: ${finalCols.some(c => c.column_name === 'entity_type') ? '✓' : '✗'}`);

    // Check that old tables are gone
    const oldTables = ['participants', 'display_sessions', 'puzzle_sets'];
    for (const tableName of oldTables) {
      const exists = tables.some(t => t.table_name === tableName);
      console.log(`   Table '${tableName}': ${exists ? '✗ (should be removed)' : '✓ (correctly removed)'}`);
    }

    console.log('\n=== Test Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testSchema();
