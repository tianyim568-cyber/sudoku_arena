import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../api';

export default function PuzzleBankPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
    const tRes = await api.listTournaments();
    if (tRes.code === 200 && tRes.data.length > 0) {
      const latest = tRes.data[tRes.data.length - 1];
      const rRes = await api.listRounds(latest.id);
      if (rRes.code === 200) setRounds(rRes.data);
    }
  };

  useEffect(() => { load(); loadRounds(); }, [filter]);

  const [deleting, setDeleting] = useState(null);
  const [clearing, setClearing] = useState(false);

  const handleDelete = async (id) => {
    if (!confirm(`确定要删除题目 ${id} 吗？此操作无法撤销。`)) return;
    setDeleting(id);
    const res = await api.deletePuzzleFromBank(id);
    if (res.code === 200) {
      load();
    } else {
      alert('删除失败：' + (res.message || '未知错误'));
    }
    setDeleting(null);
  };

  const handleClearAll = async () => {
    if (!confirm('确定要清除题库中的所有题目吗？此操作无法撤销。')) return;
    if (!confirm('你确定吗？每道题目都将被永久删除。')) return;
    setClearing(true);
    const res = await api.clearPuzzleBank();
    if (res.code === 200) {
      alert(`已从题库中清除 ${res.data.deleted} 道题目。`);
      load();
    } else {
      alert('清除失败：' + (res.message || '未知错误'));
    }
    setClearing(false);
  };

  const handleGenerate = async (roundType, teamsCount) => {
    setGenerating(true);
    const res = await api.generatePuzzles(roundType, teamsCount);
    if (res.code === 200) {
      alert(`已为 ${roundType.replace(/_/g, ' ')} 生成 ${res.data.generated} 道题目。题库当前共 ${res.data.totalInBank} 道`);
      load();
    } else {
      alert('生成失败：' + (res.message || '未知错误'));
    }
    setGenerating(false);
  };

  const handleBulkGenerate = async () => {
    const tc = parseInt(bulkTeamsCount);
    if (!tc || tc < 1) return alert('请输入有效的队伍数量');
    setBulkGenerating(true);
    try {
      const res = await api.generatePuzzlesBulk(tc);
      if (res.code === 200) {
        const d = res.data;
        alert(
          `已为 ${tc} 支队伍批量生成完成：\n` +
          `R1：${d.r1.generated} 道 (${tc} x 10: 9道简单JOC + 1道FINAL)\n` +
          `R2：${d.r2.generated} 道 (${tc} x 16: 8E+6M+2H)\n` +
          `R3：${d.r3.generated} 道 (5E+3M+2H)\n` +
          `共计：${d.totalGenerated} 道新题。题库当前共 ${d.totalInBank} 道。`
        );
        load();
      } else {
        alert('批量生成失败：' + (res.message || '未知错误'));
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
    if (!selectedRound) return alert('请选择一个轮次');
    setImporting(true);
    const res = await api.request('POST', '/puzzle-bank/import-to-round', {
      roundId: parseInt(selectedRound),
      count: 0,
    });
    if (res.code === 200) {
      alert(`已导入 ${res.data.imported} 道题目！`);
    } else {
      alert('导入失败：' + res.message);
    }
    setImporting(false);
  };

  const difficultyColor = { EASY: 'bg-green-100 text-green-700', MEDIUM: 'bg-yellow-100 text-yellow-700', HARD: 'bg-red-100 text-red-700' };
  const roundTypeLabel = { ROUND1_NINE_ONE: '九宫一填', ROUND2_RELAY: '接力轮转', ROUND3_COLLABORATE: '协作攻坚' };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600">&larr; 返回</button>
            <div>
              <h1 className="text-xl font-bold text-gray-800">题库</h1>
              <p className="text-sm text-gray-500">{total} 道题目可用</p>
            </div>
          </div>
          {total > 0 && (
            <button
              onClick={handleClearAll}
              disabled={clearing}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium text-sm disabled:opacity-50 transition-colors"
            >
              {clearing ? '清除中...' : '清除全部题目'}
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Bulk Generate */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-2">批量生成</h2>
          <p className="text-sm text-gray-500 mb-4">
            一次性为所有轮次生成题目。输入队伍数量后点击生成。
          </p>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">队伍数量</label>
              <input type="number" min="1" value={bulkTeamsCount}
                onChange={e => setBulkTeamsCount(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div className="text-sm text-gray-600 py-2">
              <p>R1：{bulkTeamsCount} x 10 = {bulkTeamsCount * 10} (9道简单JOC + 1道FINAL)</p>
              <p>R2：{bulkTeamsCount} x 16 = {bulkTeamsCount * 16} (8E+6M+2H)</p>
              <p>R3: 10 (5E+3M+2H)</p>
            </div>
            <button onClick={handleBulkGenerate} disabled={bulkGenerating}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium disabled:opacity-50 whitespace-nowrap">
              {bulkGenerating ? '生成中...' : '生成所有轮次'}
            </button>
          </div>
        </section>

        {/* Per-Round Generate */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-2">按轮次生成</h2>
          <p className="text-sm text-gray-500 mb-4">
            为单个轮次添加题目。每次点击生成一组队伍的题目。
          </p>
          <div className="grid grid-cols-3 gap-4">
            <button onClick={() => handleGenerate('ROUND1_NINE_ONE', 1)} disabled={generating}
              className="px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium disabled:opacity-50 text-sm">
              + R1：10 道题<br/>
              <span className="text-green-200 text-xs">9道简单JOC + 1道中等FINAL</span>
            </button>
            <button onClick={() => handleGenerate('ROUND2_RELAY', 1)} disabled={generating}
              className="px-4 py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-medium disabled:opacity-50 text-sm">
              + R2：16 道题<br/>
              <span className="text-yellow-200 text-xs">8E + 6M + 2H</span>
            </button>
            <button onClick={() => handleGenerate('ROUND3_COLLABORATE', 1)} disabled={generating}
              className="px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium disabled:opacity-50 text-sm">
              + R3：10 道题<br/>
              <span className="text-red-200 text-xs">5E + 3M + 2H</span>
            </button>
          </div>
        </section>

        {/* Import to Round */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">导入到轮次</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">轮次：</span>
            <select value={selectedRound} onChange={e => setSelectedRound(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm flex-1">
              <option value="">选择轮次...</option>
              {rounds.map(r => (
                <option key={r.id} value={r.id}>
                  第 {r.round_number} 轮：{r.name} ({r.round_type})
                </option>
              ))}
            </select>
            <button onClick={handleImport} disabled={importing || !selectedRound}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium disabled:opacity-50">
              {importing ? '导入中...' : '从题库导入'}
            </button>
          </div>
        </section>

        {/* Filters */}
        <div className="flex gap-3">
          <select value={filter.roundType} onChange={e => setFilter({...filter, roundType: e.target.value})}
            className="px-3 py-2 border rounded-lg text-sm bg-white">
            <option value="">所有轮次类型</option>
            <option value="ROUND1_NINE_ONE">第一轮：九宫一填</option>
            <option value="ROUND2_RELAY">第二轮：接力轮转</option>
            <option value="ROUND3_COLLABORATE">第三轮：协作攻坚</option>
          </select>
          <select value={filter.difficulty} onChange={e => setFilter({...filter, difficulty: e.target.value})}
            className="px-3 py-2 border rounded-lg text-sm bg-white">
            <option value="">所有难度</option>
            <option value="EASY">简单</option>
            <option value="MEDIUM">中等</option>
            <option value="HARD">困难</option>
          </select>
        </div>

        {/* Puzzle list */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">难度</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">空格数</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">题目类型</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">分值</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">预览</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {puzzles.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono font-medium">{p.id}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{roundTypeLabel[p.roundType] || p.roundType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${difficultyColor[p.difficulty] || ''}`}>
                      {p.difficulty}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.initialGrid.flat().filter(v=>v===0).length}</td>
                  <td className="px-4 py-3 text-sm">{p.puzzleType || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.points}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handlePreview(p.id)}
                      className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded text-xs hover:bg-indigo-200">
                      查看
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={deleting === p.id}
                      className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200 disabled:opacity-50 transition-colors"
                    >
                      {deleting === p.id ? '删除中...' : '删除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Preview modal */}
        {preview && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setPreview(null)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">题目 {preview.id}</h2>
                <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 mb-2">初始棋盘</h3>
                  <SudokuPreview grid={preview.initialGrid} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 mb-2">答案</h3>
                  <SudokuPreview grid={preview.solution} highlight />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-gray-500">类型</p>
                  <p className="font-medium">{roundTypeLabel[preview.roundType] || preview.roundType}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-gray-500">难度</p>
                  <p className="font-medium">{preview.difficulty}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-gray-500">空格数</p>
                  <p className="font-medium">{preview.emptyCellCount}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-gray-500">题目类型</p>
                  <p className="font-medium">{preview.puzzleType || '-'}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function SudokuPreview({ grid, highlight }) {
  if (!grid || grid.length === 0) return null;
  return (
    <div className="inline-block border-2 border-gray-300 rounded">
      {grid.map((row, ri) => (
        <div key={ri} className="flex">
          {row.map((cell, ci) => {
            const borderClasses = [
              ri % 3 === 2 && ri < 8 ? 'border-b-2 border-b-gray-400' : '',
              ci % 3 === 2 && ci < 8 ? 'border-r-2 border-r-gray-400' : '',
            ].join(' ');
            return (
              <div key={ci} className={`w-8 h-8 flex items-center justify-center text-sm border border-gray-200 ${borderClasses} ${
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
