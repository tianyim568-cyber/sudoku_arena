/**
 * Diagnostic script: reproduce the createStandalone call that fails
 * during PDF import confirm. Run with: node test_puzzle_create.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Sample 2D array like PdfImportService produces
  const initialGrid = [
    [5,3,0,0,7,0,0,0,0],
    [6,0,0,1,9,5,0,0,0],
    [0,9,8,0,0,0,0,6,0],
    [8,0,0,0,6,0,0,0,3],
    [4,0,0,8,0,3,0,0,1],
    [7,0,0,0,2,0,0,0,6],
    [0,6,0,0,0,0,2,8,0],
    [0,0,0,4,1,9,0,0,5],
    [0,0,0,0,8,0,0,7,9],
  ];

  const solutionGrid = [
    [5,3,4,6,7,8,9,1,2],
    [6,7,2,1,9,5,3,4,8],
    [1,9,8,3,4,2,5,6,7],
    [8,5,9,7,6,1,4,2,3],
    [4,2,6,8,5,3,7,9,1],
    [7,1,3,9,2,4,8,5,6],
    [9,6,1,5,3,7,2,8,4],
    [2,8,7,4,1,9,6,3,5],
    [3,4,5,2,8,6,1,7,9],
  ];

  console.log('Testing prisma.puzzles.create with PDF-import-like data...');
  try {
    const row = await prisma.puzzles.create({
      data: {
        type: 'JOC',
        initial_grid: initialGrid,
        solution_grid: solutionGrid,
        difficulty: 'EASY',
        score: 100,
        organization_id: null,
        category_id: null,
        round_type: 'ROUND1_NINE_ONE',
      },
    });
    console.log('SUCCESS! Created puzzle:', row.id);

    // Clean up
    await prisma.puzzles.delete({ where: { id: row.id } });
    console.log('Cleaned up test puzzle.');
  } catch (err) {
    console.error('FAILED!');
    console.error('Error name:', err.name);
    console.error('Error code:', err.code);
    console.error('Error message:', err.message);
    console.error('Error meta:', JSON.stringify(err.meta, null, 2));
    console.error('Full error:', err);
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
