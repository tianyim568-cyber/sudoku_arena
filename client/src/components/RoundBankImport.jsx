/**
 * RoundBankImport — inline puzzle picker attached to a single round.
 *
 * Loads puzzles from the bank filtered by the round's type (uses the
 * Phase 1 endpoint GET /puzzle-bank/by-type/:roundType). Shows a
 * scrollable table with checkboxes so the admin can pick which puzzles
 * to import into this round.
 *
 * Collapsed by default: a single "Import from bank" button next to
 * "Import PDF". Clicking expands the picker for this round only.
 *
 * Server guard: refuses to import if the round already has puzzles
 * (40030). The panel surfaces the reason so the admin can clear the
 * round first if needed.
 */
import { useState, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

const DIFFICULTY_COLOR = {
  EASY: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HARD: 'bg-red-100 text-red-700',
};

// Tiny 9×9 grid preview — reads a 2-D array of digits (0 = empty).
// Non-interactive; solely for the admin to spot obvious garbage.
function MiniGrid({ grid }) {
  if (!grid || grid.length !== 9) return null;
  return (
    <div className="grid grid-cols-9 gap-px bg-gray-300 p-px w-24">
      {grid.flat().map((v, i) => (
        <div
          key={i}
          className="bg-white text-[0.55rem] leading-none w-full aspect-square flex items-center justify-center"
        >
          {v === 0 ? '' : v}
        </div>
      ))}
    </div>
  );
}

export default function RoundBankImport({ round, onImported, onSuccess }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [puzzles, setPuzzles] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [difficultyFilter, setDifficultyFilter] = useState('');

  const PAGE_SIZE = 50;
  const roundType = round.type;

  const reset = () => {
    setPuzzles([]);
    setSelected(new Set());
    setError(null);
    setTotal(0);
    setOffset(0);
    setDifficultyFilter('');
  };

  const handleClose = () => {
    reset();
    setOpen(false);
  };

  useEffect(() => {
    if (open && roundType) {
      loadPuzzles(0);
    }
  }, [open, roundType, difficultyFilter]);

  const loadPuzzles = async (appendOffset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: PAGE_SIZE, offset: appendOffset };
      if (difficultyFilter) params.difficulty = difficultyFilter;
      const res = await api.listPuzzlesByType(roundType, params);
      if (res.code === 200) {
        if (appendOffset === 0) {
          setPuzzles(res.data.puzzles);
        } else {
          setPuzzles(prev => [...prev, ...res.data.puzzles]);
        }
        setTotal(res.data.total);
        setOffset(appendOffset + res.data.puzzles.length);
      } else {
        setError(res.message || t('roundBankImport.loadFailed'));
      }
    } catch (err) {
      setError(t('roundBankImport.loadFailed'));
    }
    setLoading(false);
  };

  const loadMore = () => {
    loadPuzzles(offset);
  };

  const hasMore = puzzles.length < total;

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(puzzles.map((p) => p.id)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    const puzzleIds = Array.from(selected);
    const res = await api.importPuzzlesToRound(round.id, undefined, puzzleIds);
    setImporting(false);
    if (res.code === 200) {
      const summary = t('roundBankImport.imported', { n: res.data.imported });
      if (typeof onSuccess === 'function') onSuccess(summary);
      reset();
      setOpen(false);
      if (typeof onImported === 'function') onImported();
      return;
    }
    setError(res.message || t('roundBankImport.importFailed'));
  };

  // Collapsed state — just a single button.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-2 py-1 text-xs text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-50"
      >
        {t('roundBankImport.openBtn')}
      </button>
    );
  }

  // Expanded — the full picker flow, inline under this round row.
  return (
    <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs sm:text-sm font-medium text-indigo-900">
          {t('roundBankImport.title', { name: round.name })}
        </h5>
        <button
          type="button"
          onClick={handleClose}
          disabled={loading || importing}
          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
          aria-label={t('roundBankImport.close')}
        >
          ×
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <label className="text-gray-600 font-medium">{t('roundBankImport.filterDifficulty')}:</label>
        <select
          value={difficultyFilter}
          onChange={(e) => setDifficultyFilter(e.target.value)}
          className="px-2 py-1 border border-indigo-200 rounded text-xs bg-white"
        >
          <option value="">{t('roundBankImport.allDifficulties')}</option>
          <option value="EASY">{t('common.difficulty.EASY')}</option>
          <option value="MEDIUM">{t('common.difficulty.MEDIUM')}</option>
          <option value="HARD">{t('common.difficulty.HARD')}</option>
        </select>
        {difficultyFilter && (
          <button
            type="button"
            onClick={() => setDifficultyFilter('')}
            className="text-indigo-600 hover:text-indigo-800"
          >
            {t('roundBankImport.clearFilter')}
          </button>
        )}
      </div>

      {loading && (
        <div className="text-xs text-gray-600">{t('roundBankImport.loading')}</div>
      )}

      {!loading && puzzles.length === 0 && (
        <div className="text-xs text-gray-600">{t('roundBankImport.empty')}</div>
      )}

      {!loading && puzzles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="text-indigo-700 hover:text-indigo-900 font-medium"
            >
              {t('roundBankImport.selectAll')}
            </button>
            <button
              type="button"
              onClick={selectNone}
              className="text-gray-600 hover:text-gray-800 font-medium"
            >
              {t('roundBankImport.selectNone')}
            </button>
            <span className="text-gray-500">
              {t('roundBankImport.selectedCount', { n: selected.size })}
            </span>
          </div>

          <div className="max-h-64 overflow-y-auto border border-indigo-100 rounded bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">
                    <input
                      type="checkbox"
                      checked={selected.size === puzzles.length && puzzles.length > 0}
                      onChange={(e) => (e.target.checked ? selectAll() : selectNone())}
                      className="rounded"
                    />
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundBankImport.colId')}</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundBankImport.colDifficulty')}</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundBankImport.colScore')}</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundBankImport.colEmptyCells')}</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundBankImport.colPreview')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {puzzles.map((p) => (
                  <tr key={p.id}>
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-2 py-1 font-mono text-[0.65rem]">{p.id}</td>
                    <td className="px-2 py-1">
                      <span className={`px-1.5 py-0.5 rounded text-[0.65rem] font-medium ${DIFFICULTY_COLOR[p.difficulty] || ''}`}>
                        {p.difficulty}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-gray-600">{p.score}</td>
                    <td className="px-2 py-1 text-gray-600">{p.emptyCellCount}</td>
                    <td className="px-2 py-1"><MiniGrid grid={p.initialGrid} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium disabled:opacity-50"
              >
                {loading ? t('roundBankImport.loading') : t('roundBankImport.loadMore', { current: puzzles.length, total })}
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-medium disabled:opacity-50"
            >
              {importing ? t('roundBankImport.importing') : t('roundBankImport.importBtn')}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={importing}
              className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded text-xs font-medium disabled:opacity-50"
            >
              {t('roundBankImport.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
