import { useState, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Puzzle Bank page migrated into the dashboard layout. The standalone
// PuzzleBankPage had its own header, back button and LanguageSwitcher;
// here those live in DashboardLayout, so this component only renders the
// working content (generate / import / filter / table / preview modal).
export default function DashboardPuzzleBankPage() {
  const { t } = useLanguage();
  const [puzzles, setPuzzles] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState({ roundType: '', difficulty: '' });
  const [preview, setPreview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rounds, setRounds] = useState([]);
  const [selectedRound, setSelectedRound] = useState('');
  const [bulkTeamsCount, setBulkTeamsCount] = useState(1);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  // BUG-04 fix: solo (INDIVIDUAL_STANDARD) rounds need their own generator
  // path. Per-round buttons above are team-shaped (R1/R2/R3), so a separate
  // input + button lives in its own section. Default 10 matches the ratio
  // used by the server (5 easy + 3 medium + 2 hard).
  const [individualCount, setIndividualCount] = useState(10);
  const [individualGenerating, setIndividualGenerating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [clearing, setClearing] = useState(false);

  const load = async () => {
    const params = new URLSearchParams();
    if (filter.roundType) params.set('roundType', filter.roundType);
    if (filter.difficulty) params.set('difficulty', filter.difficulty);
    const res = await api.request('GET', `/puzzle-bank?${params.toString()}`);
    if (res.code === 200) {
      setPuzzles(res.data.puzzles);
      setTotal(res.data.total);
    }
  };

  const loadRounds = async () => {
    const tRes = await api.listCompetitions();
    if (tRes.code === 200 && tRes.data.length > 0) {
      const latest = tRes.data[tRes.data.length - 1];
      const rRes = await api.listRounds(latest.id);
      if (rRes.code === 200) setRounds(rRes.data);
    }
  };

  useEffect(() => { load(); loadRounds(); }, [filter]);

  const handleDelete = async (id) => {
    if (!confirm(t('puzzleBank.confirmDeletePuzzle', { id }))) return;
    setDeleting(id);
    const res = await api.deletePuzzleFromBank(id);
    if (res.code === 200) {
      load();
    } else {
      alert(t('puzzleBank.deleteFailed', { msg: res.message || t('common.unknownError') }));
    }
    setDeleting(null);
  };

  const handleClearAll = async () => {
    if (!confirm(t('puzzleBank.confirmClearAll1'))) return;
    if (!confirm(t('puzzleBank.confirmClearAll2'))) return;
    setClearing(true);
    const res = await api.clearPuzzleBank();
    if (res.code === 200) {
      alert(t('puzzleBank.cleared', { n: res.data.deleted }));
      load();
    } else {
      alert(t('puzzleBank.clearFailed', { msg: res.message || t('common.unknownError') }));
    }
    setClearing(false);
  };

  const handleGenerate = async (roundType, teamsCount) => {
    setGenerating(true);
    const res = await api.generatePuzzles(roundType, teamsCount);
    if (res.code === 200) {
      alert(t('puzzleBank.generated', { type: roundType.replace(/_/g, ' '), n: res.data.generated, total: res.data.totalInBank }));
      load();
    } else {
      alert(t('puzzleBank.generateFailed', { msg: res.message || t('common.unknownError') }));
    }
    setGenerating(false);
  };

  // BUG-04 fix: generates INDIVIDUAL_STANDARD sudokus. Runs alongside F88
  // (Sylvain's PDF import) — this path is the fastest way to populate a
  // solo round for testing; the PDF path is for real committee puzzles.
  const handleGenerateIndividual = async () => {
    const n = parseInt(individualCount);
    if (!n || n < 1) return alert(t('puzzleBank.invalidIndividualCount'));
    setIndividualGenerating(true);
    try {
      // The 2nd argument (teamsCount) is ignored for INDIVIDUAL_STANDARD
      // on the server; the 3rd argument (count) is what drives the loop.
      const res = await api.generatePuzzles('INDIVIDUAL_STANDARD', undefined, n);
      if (res.code === 200) {
        alert(t('puzzleBank.generated', {
          type: t('common.roundName.INDIVIDUAL_STANDARD'),
          n: res.data.generated,
          total: res.data.totalInBank,
        }));
        load();
      } else {
        alert(t('puzzleBank.generateFailed', { msg: res.message || t('common.unknownError') }));
      }
    } finally {
      setIndividualGenerating(false);
    }
  };

  const handleBulkGenerate = async () => {
    const tc = parseInt(bulkTeamsCount);
    if (!tc || tc < 1) return alert(t('puzzleBank.invalidTeamCount'));
    setBulkGenerating(true);
    try {
      const res = await api.generatePuzzlesBulk(tc);
      if (res.code === 200) {
        const d = res.data;
        alert(t('puzzleBank.bulkGenerated', {
          tc, r1: d.r1.generated, r2: d.r2.generated, r3: d.r3.generated,
          total: d.totalGenerated, inBank: d.totalInBank,
        }));
        load();
      } else {
        alert(t('puzzleBank.bulkGenerateFailed', { msg: res.message || t('common.unknownError') }));
      }
    } finally {
      setBulkGenerating(false);
    }
  };

  const handlePreview = async (id) => {
    const res = await api.request('GET', `/puzzle-bank/${id}/preview`);
    if (res.code === 200) setPreview(res.data);
    else setPreview(null);
  };

  const handleImport = async () => {
    if (!selectedRound) return alert(t('puzzleBank.selectRoundAlert'));
    setImporting(true);
    // Omit `count` — the Zod schema on the server rejects `0` (`positive()`
    // constraint). The service already treats an absent count as "all
    // available" for team rounds. Sending `count: 0` used to surface as a
    // cryptic "Too small: expected number to be >0" alert (BUG-05).
    const res = await api.request('POST', '/puzzle-bank/import-to-round', {
      roundId: selectedRound,
    });
    if (res.code === 200) {
      alert(t('puzzleBank.imported', { n: res.data.imported }));
    } else {
      alert(t('puzzleBank.importFailedAlert', { msg: res.message }));
    }
    setImporting(false);
  };

  const difficultyColor = { EASY: 'bg-green-100 text-green-700', MEDIUM: 'bg-yellow-100 text-yellow-700', HARD: 'bg-red-100 text-red-700' };
  const roundTypeLabel = {
    ROUND1_NINE_ONE: t('common.roundShort.ROUND1_NINE_ONE'),
    ROUND2_RELAY: t('common.roundShort.ROUND2_RELAY'),
    ROUND3_COLLABORATE: t('common.roundShort.ROUND3_COLLABORATE'),
    INDIVIDUAL_STANDARD: t('common.roundName.INDIVIDUAL_STANDARD'),
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Title row — the standalone page's header is gone; the Clear button
          sits next to the title, LanguageSwitcher lives in DashboardLayout. */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-gray-800">{t('puzzleBank.title')}</h1>
          <p className="text-xs sm:text-sm text-gray-500">{t('puzzleBank.available', { n: total })}</p>
        </div>
        {total > 0 && (
          <button
            onClick={handleClearAll}
            disabled={clearing}
            className="px-3 sm:px-4 py-1.5 sm:py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium text-xs sm:text-sm disabled:opacity-50 transition-colors"
          >
            {clearing ? t('puzzleBank.clearing') : t('puzzleBank.clearAll')}
          </button>
        )}
      </div>

      {/* Bulk Generate */}
      <section className="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-2">{t('puzzleBank.bulkGenTitle')}</h2>
        <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-4">
          {t('puzzleBank.bulkGenDesc')}
        </p>
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
          <div className="flex-1 w-full sm:w-auto">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">{t('puzzleBank.teamCount')}</label>
            <input type="number" min="1" value={bulkTeamsCount}
              onChange={e => setBulkTeamsCount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-xs sm:text-sm" />
          </div>
          <div className="text-xs sm:text-sm text-gray-600 py-2">
            <p>R1: {bulkTeamsCount} x 10 = {bulkTeamsCount * 10} (9 JOC + 1 FINAL)</p>
            <p>R2: {bulkTeamsCount} x 16 = {bulkTeamsCount * 16} (8E+6M+2H)</p>
            <p>R3: 10 (5E+3M+2H)</p>
          </div>
          <button onClick={handleBulkGenerate} disabled={bulkGenerating}
            className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium disabled:opacity-50 whitespace-nowrap text-sm sm:text-base">
            {bulkGenerating ? t('puzzleBank.bulkGenerating') : t('puzzleBank.bulkGenBtn')}
          </button>
        </div>
      </section>

      {/* Per-Round Generate */}
      <section className="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-2">{t('puzzleBank.perRoundTitle')}</h2>
        <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-4">
          {t('puzzleBank.perRoundDesc')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <button onClick={() => handleGenerate('ROUND1_NINE_ONE', 1)} disabled={generating}
            className="px-3 sm:px-4 py-2.5 sm:py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium disabled:opacity-50 text-xs sm:text-sm">
            {t('puzzleBank.r1Btn')}<br/>
            <span className="text-green-200 text-xs">{t('puzzleBank.r1BtnSub')}</span>
          </button>
          <button onClick={() => handleGenerate('ROUND2_RELAY', 1)} disabled={generating}
            className="px-3 sm:px-4 py-2.5 sm:py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-medium disabled:opacity-50 text-xs sm:text-sm">
            {t('puzzleBank.r2Btn')}<br/>
            <span className="text-yellow-200 text-xs">8E + 6M + 2H</span>
          </button>
          <button onClick={() => handleGenerate('ROUND3_COLLABORATE', 1)} disabled={generating}
            className="px-3 sm:px-4 py-2.5 sm:py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium disabled:opacity-50 text-xs sm:text-sm">
            {t('puzzleBank.r3Btn')}<br/>
            <span className="text-red-200 text-xs">5E + 3M + 2H</span>
          </button>
        </div>
      </section>

      {/* Individual (solo) Generate — separate section because it is not
          team-shaped and takes a `count` rather than a `teamsCount`. This
          section is the temporary path until F88 (PDF import by Sylvain)
          lands; the two coexist afterwards. */}
      <section className="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-2">{t('puzzleBank.individualTitle')}</h2>
        <p className="text-xs sm:text-sm text-gray-500 mb-3 sm:mb-4">
          {t('puzzleBank.individualDesc')}
        </p>
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
          <div className="flex-1 w-full sm:w-auto">
            <label htmlFor="individualCount" className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
              {t('puzzleBank.individualCountLabel')}
            </label>
            <input
              id="individualCount"
              type="number"
              min="1"
              value={individualCount}
              onChange={e => setIndividualCount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-xs sm:text-sm"
            />
          </div>
          <button
            onClick={handleGenerateIndividual}
            disabled={individualGenerating}
            className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium disabled:opacity-50 whitespace-nowrap text-sm sm:text-base"
          >
            {individualGenerating ? t('puzzleBank.individualGenerating') : t('puzzleBank.individualBtn')}
          </button>
        </div>
      </section>

      {/* Import to Round */}
      <section className="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t('puzzleBank.importTitle')}</h2>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
          <span className="text-xs sm:text-sm text-gray-600">{t('puzzleBank.roundLabel')}</span>
          <select value={selectedRound} onChange={e => setSelectedRound(e.target.value)}
            className="px-3 py-2 border rounded-lg text-xs sm:text-sm flex-1 w-full sm:w-auto">
            <option value="">{t('puzzleBank.selectRound')}</option>
            {rounds.map(r => (
              <option key={r.id} value={r.id}>
                {t('puzzleBank.roundOption', { n: r.order_number, name: r.name, type: r.type })}
              </option>
            ))}
          </select>
          <button onClick={handleImport} disabled={importing || !selectedRound}
            className="w-full sm:w-auto px-4 sm:px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium disabled:opacity-50 text-sm sm:text-base">
            {importing ? t('puzzleBank.importing') : t('puzzleBank.importBtn')}
          </button>
        </div>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <select value={filter.roundType} onChange={e => setFilter({...filter, roundType: e.target.value})}
          className="px-3 py-2 border rounded-lg text-xs sm:text-sm bg-white flex-1 sm:flex-initial min-w-0">
          <option value="">{t('puzzleBank.allRoundTypes')}</option>
          <option value="ROUND1_NINE_ONE">{t('common.roundName.ROUND1_NINE_ONE')}</option>
          <option value="ROUND2_RELAY">{t('common.roundName.ROUND2_RELAY')}</option>
          <option value="ROUND3_COLLABORATE">{t('common.roundName.ROUND3_COLLABORATE')}</option>
          <option value="INDIVIDUAL_STANDARD">{t('common.roundName.INDIVIDUAL_STANDARD')}</option>
        </select>
        <select value={filter.difficulty} onChange={e => setFilter({...filter, difficulty: e.target.value})}
          className="px-3 py-2 border rounded-lg text-xs sm:text-sm bg-white flex-1 sm:flex-initial min-w-0">
          <option value="">{t('puzzleBank.allDifficulties')}</option>
          <option value="EASY">{t('common.difficulty.EASY')}</option>
          <option value="MEDIUM">{t('common.difficulty.MEDIUM')}</option>
          <option value="HARD">{t('common.difficulty.HARD')}</option>
        </select>
      </div>

      {/* Puzzle list */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('puzzleBank.colType')}</th>
                <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('puzzleBank.colDifficulty')}</th>
                <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">{t('puzzleBank.colEmptyCells')}</th>
                <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">{t('puzzleBank.colPuzzleType')}</th>
                <th className="px-3 sm:px-4 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('puzzleBank.colPoints')}</th>
                <th className="px-3 sm:px-4 py-2 sm:py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('puzzleBank.colPreview')}</th>
                <th className="px-3 sm:px-4 py-2 sm:py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('puzzleBank.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {puzzles.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-mono font-medium">{p.id}</td>
                  <td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-gray-600">{roundTypeLabel[p.roundType] || p.roundType}</td>
                  <td className="px-3 sm:px-4 py-2 sm:py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${difficultyColor[p.difficulty] || ''}`}>
                      {p.difficulty}
                    </span>
                  </td>
                  <td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-gray-600 hidden sm:table-cell">{p.initialGrid.flat().filter(v=>v===0).length}</td>
                  <td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm hidden md:table-cell">{p.puzzleType || '-'}</td>
                  <td className="px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm text-gray-600">{p.points}</td>
                  <td className="px-3 sm:px-4 py-2 sm:py-3 text-right">
                    <button onClick={() => handlePreview(p.id)}
                      className="px-2 sm:px-3 py-1 bg-indigo-100 text-indigo-700 rounded text-xs hover:bg-indigo-200">
                      {t('puzzleBank.view')}
                    </button>
                  </td>
                  <td className="px-3 sm:px-4 py-2 sm:py-3 text-right">
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={deleting === p.id}
                      className="px-2 sm:px-3 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200 disabled:opacity-50 transition-colors"
                    >
                      {deleting === p.id ? t('puzzleBank.deleting') : t('puzzleBank.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-base sm:text-lg font-bold">{t('puzzleBank.previewTitle', { id: preview.id })}</h2>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-gray-500 mb-2">{t('puzzleBank.initialBoard')}</h3>
                <SudokuPreview grid={preview.initialGrid} />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-gray-500 mb-2">{t('puzzleBank.answer')}</h3>
                <SudokuPreview grid={preview.solution} highlight />
              </div>
            </div>
            <div className="mt-3 sm:mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-xs sm:text-sm">
              <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                <p className="text-gray-500">{t('puzzleBank.colType')}</p>
                <p className="font-medium">{roundTypeLabel[preview.roundType] || preview.roundType}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                <p className="text-gray-500">{t('puzzleBank.colDifficulty')}</p>
                <p className="font-medium">{preview.difficulty}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                <p className="text-gray-500">{t('puzzleBank.colEmptyCells')}</p>
                <p className="font-medium">{preview.emptyCellCount}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                <p className="text-gray-500">{t('puzzleBank.colPuzzleType')}</p>
                <p className="font-medium">{preview.puzzleType || '-'}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SudokuPreview({ grid, highlight }) {
  if (!grid || grid.length === 0) return null;
  return (
    <div className="inline-block border-2 border-gray-300 rounded overflow-x-auto max-w-full">
      {grid.map((row, ri) => (
        <div key={ri} className="flex">
          {row.map((cell, ci) => {
            const borderClasses = [
              ri % 3 === 2 && ri < 8 ? 'border-b-2 border-b-gray-400' : '',
              ci % 3 === 2 && ci < 8 ? 'border-r-2 border-r-gray-400' : '',
            ].join(' ');
            return (
              <div key={ci} className={`w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center text-xs sm:text-sm border border-gray-200 ${borderClasses} ${
                cell === 0 ? 'bg-gray-100 text-gray-300' : highlight ? 'bg-blue-50 font-medium' : ''
              }`}>
                {cell !== 0 ? cell : ''}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
