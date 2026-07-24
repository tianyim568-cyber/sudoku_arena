/**
 * setup-postgres.js — Local PostgreSQL setup script.
 *
 * Run this AFTER installing PostgreSQL on Windows.
 * It creates the sudoku_arena database and tests the connection.
 *
 * Usage:
 *   1. Install PostgreSQL 16 from the installer on your Desktop
 *      (Run as Administrator, use password "postgres")
 *   2. Add PostgreSQL to PATH: C:\Program Files\PostgreSQL\16\bin
 *   3. Run: node scripts/setup-postgres.js
 */

const { execSync } = require('child_process');
const path = require('path');

const PG_BIN = process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\16\\bin';
const PSQL = path.join(PG_BIN, 'psql.exe');
const CREATEDB = path.join(PG_BIN, 'createdb.exe');
const PG_PASSWORD = process.env.PGPASSWORD || 'postgres';

async function main() {
  console.log('=== Sudoku Arena — PostgreSQL Setup ===\n');

  // Step 1: Create database
  console.log('Step 1: Creating sudoku_arena database...');
  try {
    process.env.PGPASSWORD = PG_PASSWORD;
    execSync(`"${CREATEDB}" -U postgres -h localhost -p 5432 sudoku_arena`, {
      stdio: 'inherit',
      env: { ...process.env, PGPASSWORD: PG_PASSWORD }
    });
    console.log('Database created.\n');
  } catch (e) {
    if (e.stderr && e.stderr.toString().includes('already exists')) {
      console.log('Database already exists.\n');
    } else {
      console.log('Could not create database. It may already exist, or PostgreSQL is not running.');
      console.log('Error:', e.message);
    }
  }

  // Step 2: Test connection with pg driver
  console.log('Step 2: Testing connection via pg driver...');
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'sudoku_arena',
      user: 'postgres',
      password: PG_PASSWORD,
    });

    const result = await pool.query('SELECT NOW() as now');
    console.log('Connection successful! Server time:', result.rows[0].now);
    await pool.end();
  } catch (e) {
    console.log('Connection failed:', e.message);
    console.log('\nMake sure PostgreSQL is running and the database exists.');
    console.log('You can also try: psql -U postgres -c "CREATE DATABASE sudoku_arena"');
    process.exit(1);
  }

  // Step 3: Start the server
  console.log('\nStep 3: Starting the Sudoku Arena server...');
  console.log('Run: cd server && npm start');
  console.log('\nThe server will automatically create all tables and seed demo users on first start.');
}

main().catch(console.error);
