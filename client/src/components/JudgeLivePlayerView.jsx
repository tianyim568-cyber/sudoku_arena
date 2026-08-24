/**
 * JudgeLivePlayerView — the per-player live view shown inside JudgeMonitoringPanel.
 *
 * What it shows: one participant's current state — name, session status,
 * per-puzzle progress, and the 9x9 grid the player is working on. Plus the
 * projection controls (admin only) to put this player on the big screen.
 *
 * Why a separate file: the plan (development_plan_v2.md, Day 4) lists
 * `JudgeLivePlayerView.jsx` as a named deliverable. The functionality was
 * already inline in JudgeMonitoringPanel as `ParticipantDetail` — extracting
 * it into its own file satisfies the plan without changing behavior or
 * transport. No new route, no new API, no new socket event. The parent
 * still owns the fetch, the projection state, and the lifecycle; this view
 * is presentational — it receives `detail` in props and renders it.
 *
 * Data shape — what `detail.data` contains (built by the server in
 * MonitoringService.getPlayerMonitoringDetail):
 *   {
 *     playerName: string,
 *     sessionStatus: string | null,   // WAITING / RUNNING / IN_PROGRESS / PAUSED / FINISHED
 *     roundId: string | null,        // null when no active round
 *     puzzles: Array<{
 *       puzzleId: string,
 *       correctCells: number,
 *       totalEmptyCells: number,
 *       progressPercentage: number,  // 0-100
 *       currentGrid: Array<Array<number|null>> | null,  // 9x9, or null
 *     }>,
 *   }
 *
 * The grid is a 2D array. We render it as a read-only 9x9 table. If the
 * shape is not a 2D array (unexpected server response), we fall back to a
 * <pre> dump rather than crashing — the view's job is to show state, not
 * to enforce it.
 *
 * Presentational only — touches no network. The parent fetches the data
 * and passes it via `detail`. The projection buttons call `onProject` /
 * `onStopProject` callbacks supplied by the parent, so the parent owns
 * the projection state and the API calls.
 *
 * The labels come from the i18n dictionary (same keys the inline version
 * used), so the view stays consistent with the rest of the panel when
 * the language changes.
 */

import { useLanguage } from '../i18n/LanguageContext';

/**
 * @param {object} props
 * @param {string} props.competitionId — used in projection callbacks indirectly.
 * @param {string} props.playerId — the selected participant's id.
 * @param {object} props.detail — { data, loading, error } from the parent's fetch.
 * @param {boolean} props.canProject — gates projection controls (JUDGE + SUPER_ADMIN; ORG_ADMIN excluded — 2026-08-24 product decision).
 * @param {string|null} props.projectingId — the parent's in-flight projection id.
 * @param {(playerId: string, playerName: string) => void} props.onProject
 * @param {() => void} props.onStopProject
 * @param {() => void} props.onClose
 * @param {() => void} props.onRefresh
 */
export default function JudgeLivePlayerView({
  competitionId,
  playerId,
  detail,
  canProject,
  projectingId,
  onProject,
  onStopProject,
  onClose,
  onRefresh,
}) {
  const { t } = useLanguage();

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm sm:text-base">{t('judgeMonitoring.detailTitle')}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
          >
            {t('judgeMonitoring.refresh')}
          </button>
          <button
            onClick={onClose}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>

      {detail?.loading && (
        <p className="text-gray-500 text-xs sm:text-sm">{t('common.loading')}</p>
      )}

      {detail?.error && (
        <p className="text-red-600 text-xs sm:text-sm">{detail.error}</p>
      )}

      {detail?.data && (
        <div className="space-y-3">
          {/* Player name + session status */}
          <div className="text-sm">
            <div className="font-medium">{detail.data.playerName}</div>
            {detail.data.sessionStatus && (
              <div className="text-xs text-gray-500">
                {t('judgeMonitoring.sessionStatus', { status: detail.data.sessionStatus })}
              </div>
            )}
            {!detail.data.roundId && (
              <div className="text-xs text-gray-500">{t('judgeMonitoring.noActiveRound')}</div>
            )}
            {detail.data.roundId && !detail.data.sessionStatus && (
              <div className="text-xs text-gray-500">{t('judgeMonitoring.noSession')}</div>
            )}
            {detail.data.roundId && detail.data.sessionStatus && (!detail.data.puzzles || detail.data.puzzles.length === 0) && (
              <div className="text-xs text-gray-500">{t('judgeMonitoring.noPuzzles')}</div>
            )}
          </div>

          {/* Projection controls — JUDGE-only (2026-08-24 product decision). */}
          {canProject && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onProject(playerId, detail.data.playerName)}
                disabled={projectingId !== null}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs sm:text-sm hover:bg-indigo-500 disabled:opacity-50"
              >
                {projectingId === playerId ? t('common.loading') : t('judgeMonitoring.projectButton')}
              </button>
              <button
                onClick={onStopProject}
                disabled={projectingId !== null}
                className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-xs sm:text-sm hover:bg-red-50 disabled:opacity-50"
              >
                {projectingId === 'stop' ? t('common.loading') : t('judgeMonitoring.stopProjectButton')}
              </button>
            </div>
          )}

          {/* Puzzle progress list */}
          {detail.data.puzzles && detail.data.puzzles.length > 0 && (
            <div className="space-y-3">
              {detail.data.puzzles.map((puz, i) => (
                <div key={puz.puzzleId} className="border rounded p-2">
                  <div className="text-xs sm:text-sm text-gray-600 mb-1">
                    {t('judgeMonitoring.puzzleProgress', {
                      n: i + 1,
                      correct: puz.correctCells,
                      total: puz.totalEmptyCells,
                      pct: puz.progressPercentage,
                    })}
                  </div>
                  {puz.currentGrid && (
                    <GridPreview grid={puz.currentGrid} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * GridPreview — a read-only 9x9 rendering of a player's current grid.
 *
 * The server stores `currentGrid` as a 2D array (rows of cells). We
 * render it as a table with tight borders so the judge can see the
 * shape of the player's progress at a glance. If the shape is not a
 * 2D array (unexpected), we fall back to a <pre> dump rather than
 * crashing — the view's job is to show state, not to enforce it.
 */
export function GridPreview({ grid }) {
  if (!Array.isArray(grid) || !Array.isArray(grid[0])) {
    return (
      <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
        {JSON.stringify(grid, null, 2)}
      </pre>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs sm:text-sm mx-auto">
        <tbody>
          {grid.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className="border border-gray-300 w-6 h-6 sm:w-7 sm:h-7 text-center"
                >
                  {cell == null || cell === '' ? '' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
