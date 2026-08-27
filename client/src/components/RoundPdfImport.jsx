/**
 * RoundPdfImport — inline two-phase PDF upload attached to a single round.
 *
 * ── Why per-round and not global ────────────────────────────────────
 * Product decision 2026-08-24 (Louise): every batch of PDF puzzles must
 * be tied to a specific round. There is no "generic pool" any more. Two
 * consequences follow:
 *   1. This flow lives ON the round (button next to "Import from bank"),
 *      not in the standalone Puzzle Bank page — an admin cannot forget
 *      which round they were configuring.
 *   2. The confirm call sends `roundId` (this round). The server writes
 *      the puzzles into the bank AND imports them into the round in one
 *      atomic step.
 *
 * ── UX ─────────────────────────────────────────────────────────────
 * Collapsed by default: a single "Import PDF" button. Clicking expands
 * the section for this round only — the other rounds stay untouched.
 * Two phases inside:
 *   Phase 1: pick a .pdf file → "Parse PDF" → server-side parsing.
 *   Phase 2: preview table (id / type / difficulty / score / empty
 *            cells) → "Confirm import" → puzzles land in bank + round.
 *
 * A round that already holds puzzles refuses the import (server-side
 * guard, 40030). The panel surfaces the reason so the admin can clear
 * the round first if needed.
 *
 * ── Reset ──────────────────────────────────────────────────────────
 * On successful confirm, the panel collapses and the parent is asked
 * to reload the round list so the puzzle count updates. On any error,
 * the panel stays open with the message so the admin can retry or
 * back out.
 */
import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

const DIFFICULTY_COLOR = {
  EASY: 'bg-green-100 text-green-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HARD: 'bg-red-100 text-red-700',
};

// Tiny 9×9 grid preview — reads a 2-D array of digits (0 = empty).
// Non-interactive; solely for the admin to spot obvious garbage in the
// parsed batch. Small so N previews fit in a scrollable table.
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

export default function RoundPdfImport({ round, onImported, onSuccess }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null); // { parsed, fileName, questions, errors }
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setFile(null);
    setParsed(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    setOpen(false);
  };

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setError(null);
    setParsed(null);
    const res = await api.uploadPdfPuzzles(file);
    if (res.code === 200) {
      setParsed(res.data);
    } else {
      setError(res.message || t('roundPdfImport.parseFailed'));
    }
    setParsing(false);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    const res = await api.confirmPdfPuzzles(round.id);
    setConfirming(false);
    if (res.code === 200) {
      const summary = res.data.strippedCategoryIds > 0
        ? t('roundPdfImport.importedWithStripped', {
            n: res.data.importedToRound,
            stripped: res.data.strippedCategoryIds,
          })
        : t('roundPdfImport.imported', { n: res.data.importedToRound });
      // Louise UX 2026-08-26: replaced alert() with an optional onSuccess
      // callback. The parent page already owns a msg() helper that shows
      // a styled toast — we delegate to it so the native browser dialog
      // never surfaces.
      if (typeof onSuccess === 'function') onSuccess(summary);
      reset();
      setOpen(false);
      if (typeof onImported === 'function') onImported();
      return;
    }
    // Partial success: bank got the puzzles, round import failed. The
    // admin can either retry (bank already has them → "Import from bank"
    // will pull them into the round) or investigate the error.
    if (res.code === 50001) {
      setError(t('roundPdfImport.partialSuccess'));
      return;
    }
    setError(res.message || t('roundPdfImport.importFailed'));
  };

  // Collapsed state — just a single button, no visual weight.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-2 py-1 text-xs text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-50"
      >
        {t('roundPdfImport.openBtn')}
      </button>
    );
  }

  // Expanded — the full two-phase flow, inline under this round row.
  return (
    <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs sm:text-sm font-medium text-indigo-900">
          {t('roundPdfImport.title', { name: round.name })}
        </h5>
        <button
          type="button"
          onClick={handleClose}
          disabled={parsing || confirming}
          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
          aria-label={t('roundPdfImport.close')}
        >
          ×
        </button>
      </div>

      {!parsed && (
        <div className="space-y-2">
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => setFile(e.target.files[0] || null)}
            aria-label={t('roundPdfImport.selectFile')}
            className="block w-full text-xs text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-indigo-100 file:text-indigo-700 hover:file:bg-indigo-200"
          />
          {file && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleParse}
                disabled={parsing}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium disabled:opacity-50"
              >
                {parsing ? t('roundPdfImport.parsing') : t('roundPdfImport.parseBtn')}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={parsing}
                className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded text-xs font-medium disabled:opacity-50"
              >
                {t('roundPdfImport.cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      {parsed && (
        <div className="space-y-3">
          <div className="p-2 bg-white border border-indigo-100 rounded text-xs">
            <p className="font-medium text-indigo-900">
              {t('roundPdfImport.parsedSummary', { n: parsed.parsed })}
            </p>
            <p className="text-gray-500 mt-0.5">
              {t('roundPdfImport.fileName', { name: parsed.fileName })}
            </p>
            {parsed.errors && parsed.errors.length > 0 && (
              <div className="mt-2 text-yellow-700">
                <p className="font-medium">{t('roundPdfImport.warnings')}</p>
                <ul className="list-disc list-inside ml-2">
                  {parsed.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto border border-indigo-100 rounded bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundPdfImport.colId')}</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundPdfImport.colDifficulty')}</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundPdfImport.colScore')}</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundPdfImport.colEmptyCells')}</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500">{t('roundPdfImport.colPreview')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parsed.questions.map((q, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 font-mono">{q.id}</td>
                    <td className="px-2 py-1">
                      <span className={`px-1.5 py-0.5 rounded text-[0.65rem] font-medium ${DIFFICULTY_COLOR[q.difficulty] || ''}`}>
                        {q.difficulty}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-gray-600">{q.score}</td>
                    <td className="px-2 py-1 text-gray-600">{q.emptyCellCount}</td>
                    <td className="px-2 py-1"><MiniGrid grid={q.initialGrid} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-medium disabled:opacity-50"
            >
              {confirming ? t('roundPdfImport.confirming') : t('roundPdfImport.confirmBtn')}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={confirming}
              className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded text-xs font-medium disabled:opacity-50"
            >
              {t('roundPdfImport.reupload')}
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
