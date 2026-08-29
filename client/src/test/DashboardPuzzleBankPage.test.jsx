import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { LanguageProvider } from '../i18n/LanguageContext'
import { api } from '../api'
import DashboardPuzzleBankPage from '../pages/DashboardPuzzleBankPage'

vi.mock('../api', () => ({
  api: {
    request: vi.fn(),
    listCompetitions: vi.fn(),
  },
  setToken: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  api.listCompetitions.mockResolvedValue({ code: 200, data: [] })
})

describe('DashboardPuzzleBankPage - initialGrid guard', () => {
  it('does not crash when puzzles have missing or undefined initialGrid', async () => {
    api.request.mockResolvedValue({
      code: 200,
      data: {
        puzzles: [
          { id: '1', name: 'Puzzle 1', difficulty: 'EASY', points: 100, roundType: 'ROUND1_NINE_ONE', initialGrid: [[1, 0, 3]] },
          { id: '2', name: 'Puzzle 2', difficulty: 'MEDIUM', points: 150, roundType: 'ROUND2_RELAY', initialGrid: undefined },
          { id: '3', name: 'Puzzle 3', difficulty: 'HARD', points: 200, roundType: 'ROUND3_COLLABORATE' },
        ],
        total: 3,
      },
    })

    // The critical assertion: render() must not throw.
    // Before the fix, p.initialGrid.flat() crashed with TypeError.
    render(
      <LanguageProvider>
        <MemoryRouter>
          <DashboardPuzzleBankPage />
        </MemoryRouter>
      </LanguageProvider>
    )

    // Wait for the async data load — the header shows "3 道题目可用".
    await waitFor(() => {
      expect(screen.getByText('3 道题目可用')).toBeInTheDocument()
    })

    // Puzzles without valid initialGrid should show "-" in the empty-cells column.
    // There should be at least 2 dashes (puzzle 2 and 3 have no grid).
    const dashCells = screen.getAllByText('-')
    expect(dashCells.length).toBeGreaterThanOrEqual(2)
  })
})
