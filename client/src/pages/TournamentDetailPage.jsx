import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { api } from '../api';

export default function TournamentDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [users, setUsers] = useState([]);
  const [showAddRound, setShowAddRound] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [roundForm, setRoundForm] = useState({ name: '', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [statusMsg, setStatusMsg] = useState(null);
  const [generatingRoundId, setGeneratingRoundId] = useState(null);
  const [quickSetting, setQuickSetting] = useState(false);

  const load = async () => {
    const res = await api.getTournament(id);
    if (res.code === 200) setTournament(res.data);
  };

  useEffect(() => {
    load();
    if (user?.role === 'ADMIN') {
      api.listUsers().then(res => { if (res.code === 200) setUsers(res.data); });
    }
  }, [id]);

  const msg = (text, type = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 5000);
  };

  const handleCreateRound = async (e) => {
    e.preventDefault();
    const res = await api.createRound(id, roundForm);
    if (res.code === 200) { setShowAddRound(false); load(); }
    else msg(res.message || t('tournamentDetail.createRoundFailed'), 'error');
  };

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    const res = await api.createTeam(id, teamName);
    if (res.code === 200) { setShowAddTeam(false); setTeamName(''); load(); }
    else msg(res.message || t('tournamentDetail.createTeamFailed'), 'error');
  };

  const handleAddMember = async (teamId) => {
    if (!selectedPlayer) return;
    const player = users.find(u => u.id === parseInt(selectedPlayer));
    if (!player) return;
    const res = await api.addTeamMember(teamId, player.id, tournament.teams.find(tm => tm.id === teamId)?.members?.length + 1);
    if (res.code === 200) load();
    else msg(res.message || t('tournamentDetail.addMemberFailed'), 'error');
  };

  const handleAssignJudge = async () => {
    const judge = users.find(u => u.role === 'JUDGE');
    if (!judge) return msg(t('tournamentDetail.judgeNotFound'), 'error');
    const res = await api.assignJudge(id, judge.id);
    if (res.code === 200) { msg(t('tournamentDetail.judgeAssigned')); load(); }
    else msg(res.message || t('tournamentDetail.assignJudgeFailed'), 'error');
  };

  const handleGenerateAndImport = async (roundId, roundType) => {
    setGeneratingRoundId(roundId);
    try {
      // Step 1: Check puzzle bank availability
      const bankRes = await api.request('GET', `/puzzle-bank?roundType=${roundType}`);
      const bankCount = bankRes.code === 200 ? (bankRes.data.total || 0) : 0;

      // Determine required count per round type (R1 depends on team count)
      const teamCount = (tournament.teams || []).length || 1;
      const requiredCount = roundType === 'ROUND1_NINE_ONE' ? teamCount * 10 : roundType === 'ROUND2_RELAY' ? 16 : 10;

      if (bankCount < requiredCount) {
        // Bank is empty or insufficient — notify admin
        const jocNeeded = roundType === 'ROUND1_NINE_ONE' ? teamCount * 9 : 0;
        const finalNeeded = roundType === 'ROUND1_NINE_ONE' ? teamCount : 0;
        const detail = roundType === 'ROUND1_NINE_ONE'
          ? ` (need ${jocNeeded} JOC + ${finalNeeded} FINAL for ${teamCount} teams)`
          : '';
        msg(t('tournamentDetail.bankInsufficient', { bankCount, type: roundType.replace(/_/g, ' '), required: requiredCount, detail }), 'error');
        return;
      }

      // Step 2: Import from bank (server validates and imports for all teams)
      const impRes = await api.importPuzzlesToRound(parseInt(roundId), teamCount);
      if (impRes.code === 200) {
        const data = impRes.data;
        if (data.jocImported !== undefined) {
          msg(t('tournamentDetail.importedR1', { joc: data.jocImported, final: data.finalImported, teams: data.teams }));
        } else {
          msg(t('tournamentDetail.importedGeneric', { count: data.imported }));
        }
        load();
      } else {
        msg(t('tournamentDetail.importFailed', { msg: impRes.message || impRes.data?.error || t('common.unknownError') }), 'error');
      }
    } catch (e) {
      msg(t('tournamentDetail.error', { msg: e.message }), 'error');
    } finally {
      setGeneratingRoundId(null);
    }
  };

  const handleQuickSetup = async () => {
    setQuickSetting(true);
    try {
      // 1. Create missing rounds
      const existingRounds = tournament.rounds || [];
      const roundDefs = [
        { name: '第一轮 - 九宫一填', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 },
        { name: '第二轮 - 接力轮转', roundType: 'ROUND2_RELAY', durationSeconds: 600 },
        { name: '第三轮 - 协作攻坚', roundType: 'ROUND3_COLLABORATE', durationSeconds: 600 },
      ];
      const typesExisting = existingRounds.map(r => r.round_type);
      for (const rd of roundDefs) {
        if (!typesExisting.includes(rd.roundType)) {
          await api.createRound(id, rd);
        }
      }
      // Reload to get new round IDs
      const freshRes = await api.getTournament(id);
      const freshTournament = freshRes.code === 200 ? freshRes.data : tournament;

      // 1b. Import puzzles for rounds that have none — check bank first
      const teamCount = (freshTournament.teams || []).length || 1;
      const requiredByType = { ROUND1_NINE_ONE: teamCount * 10, ROUND2_RELAY: 16, ROUND3_COLLABORATE: 10 };
      let bankWarning = null;

      for (const r of (freshTournament.rounds || [])) {
        if ((r.puzzles?.length || 0) === 0) {
          // Check bank availability
          const bankRes = await api.request('GET', `/puzzle-bank?roundType=${r.round_type}`);
          const bankCount = bankRes.code === 200 ? (bankRes.data.total || 0) : 0;
          const required = requiredByType[r.round_type] || 10;

          if (bankCount < required) {
            const detail = r.round_type === 'ROUND1_NINE_ONE'
              ? ` (need ${teamCount * 9} JOC + ${teamCount} FINAL for ${teamCount} teams)`
              : '';
            bankWarning = t('tournamentDetail.bankInsufficient', { bankCount, type: r.round_type.replace(/_/g, ' '), required, detail });
            continue; // Skip this round
          }

          // Import from bank (random selection happens server-side)
          await api.importPuzzlesToRound(r.id, teamCount);
        }
      }

      // 2. Create teams if none
      if ((tournament.teams || []).length === 0) {
        await api.createTeam(id, 'Alpha 队');
        await api.createTeam(id, 'Beta 队');
      }

      // 3. Assign judge if none
      if ((tournament.judges || []).length === 0) {
        const judge = users.find(u => u.role === 'JUDGE');
        if (judge) await api.assignJudge(id, judge.id);
      }

      // Reload
      await load();

      if (bankWarning) {
        msg(bankWarning, 'error');
      } else {
        msg(t('tournamentDetail.quickSetupDone'));
      }
    } catch (e) {
      msg(t('tournamentDetail.quickSetupError', { msg: e.message }), 'error');
    } finally {
      setQuickSetting(false);
    }
  };

  const handleStartTournament = async () => {
    const res = await api.startTournament(id);
    if (res.code === 200) {
      msg(t('tournamentDetail.tournamentStarted'));
      navigate(`/judge/${id}`);
    } else {
      msg(t('tournamentDetail.startFailed', { msg: res.message || t('common.unknownError') }), 'error');
    }
  };

  const isAdmin = user?.role === 'ADMIN';
  const isJudge = user?.role === 'JUDGE';
  const isPlayer = user?.role === 'PLAYER';

  // Readiness checks
  const has3Rounds = (tournament?.rounds?.length || 0) >= 3;
  const allRoundsHavePuzzles = has3Rounds && tournament.rounds.every(r => (r.puzzles?.length || 0) > 0);
  const hasTeam = (tournament?.teams?.length || 0) >= 1;
  const hasJudge = (tournament?.judges?.length || 0) >= 1;
  const allReady = has3Rounds && allRoundsHavePuzzles && hasTeam && hasJudge;

  if (!tournament) return <div className="flex items-center justify-center h-screen">{t('common.loading')}</div>;

  const Check = ({ ok }) => (
    <span className={`inline-block w-5 h-5 rounded-full text-center text-white text-xs leading-5 ${ok ? 'bg-green-500' : 'bg-red-400'}`}>
      {ok ? '✓' : '✗'}
    </span>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600">&larr; {t('tournamentDetail.back')}</button>
            <div>
              <h1 className="text-xl font-bold text-gray-800">{tournament.name}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                tournament.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                tournament.status === 'IN_PROGRESS' ? 'bg-green-100 text-green-700' :
                tournament.status === 'PAUSED' ? 'bg-orange-100 text-orange-700' :
                'bg-gray-100 text-gray-700'
              }`}>{t(`common.status.${tournament.status}`)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            {isAdmin && tournament.status === 'PENDING' && !allReady && (
              <button onClick={handleQuickSetup} disabled={quickSetting}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 disabled:opacity-50">
                {quickSetting ? t('tournamentDetail.quickSettingUp') : t('tournamentDetail.quickSetup')}
              </button>
            )}
            {(isJudge || isAdmin) && (
              <button onClick={() => navigate(`/judge/${id}`)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500">
                {t('tournamentDetail.judgeConsole')}
              </button>
            )}
            {isPlayer && tournament.status === 'IN_PROGRESS' && (
              <button onClick={() => navigate(`/play/${id}`)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500">
                {t('tournamentDetail.enterGame')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Status Message */}
        {statusMsg && (
          <div className={`px-4 py-3 rounded-lg text-sm ${
            statusMsg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
            'bg-green-50 text-green-700 border border-green-200'
          }`}>{statusMsg.text}</div>
        )}

        {/* Readiness Checklist (only when PENDING) */}
        {tournament.status === 'PENDING' && (
          <section className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-3">{t('tournamentDetail.readinessTitle')}</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2"><Check ok={has3Rounds} /> {t('tournamentDetail.check3Rounds')}</div>
              <div className="flex items-center gap-2"><Check ok={allRoundsHavePuzzles} /> {t('tournamentDetail.checkPuzzles')}</div>
              <div className="flex items-center gap-2"><Check ok={hasTeam} /> {t('tournamentDetail.checkTeam')}</div>
              <div className="flex items-center gap-2"><Check ok={hasJudge} /> {t('tournamentDetail.checkJudge')}</div>
            </div>
            {allReady && (
              <div className="mt-4 pt-4 border-t flex items-center gap-3">
                <p className="text-green-600 font-medium text-sm">{t('tournamentDetail.allReady')}</p>
                <button onClick={handleStartTournament}
                  className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium">
                  {t('tournamentDetail.startTournament')}
                </button>
              </div>
            )}
          </section>
        )}

        {/* Rounds Section */}
        <section className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{t('tournamentDetail.roundsTitle')} ({tournament.rounds?.length || 0}/3)</h2>
            {isAdmin && tournament.status === 'PENDING' && tournament.rounds?.length < 3 && (
              <button onClick={() => setShowAddRound(!showAddRound)}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-500">
                {t('tournamentDetail.addRound')}
              </button>
            )}
          </div>

          {showAddRound && (
            <form onSubmit={handleCreateRound} className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
              <input type="text" placeholder={t('tournamentDetail.roundNamePlaceholder')} value={roundForm.name}
                onChange={e => setRoundForm({ ...roundForm, name: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm" required />
              <select value={roundForm.roundType} onChange={e => setRoundForm({ ...roundForm, roundType: e.target.value })}
                className="w-full px-3 py-2 border rounded text-sm">
                <option value="ROUND1_NINE_ONE">{t('common.roundName.ROUND1_NINE_ONE')}</option>
                <option value="ROUND2_RELAY">{t('common.roundName.ROUND2_RELAY')}</option>
                <option value="ROUND3_COLLABORATE">{t('common.roundName.ROUND3_COLLABORATE')}</option>
              </select>
              <input type="number" placeholder={t('tournamentDetail.durationPlaceholder')} value={roundForm.durationSeconds}
                onChange={e => setRoundForm({ ...roundForm, durationSeconds: parseInt(e.target.value) || 600 })}
                className="w-full px-3 py-2 border rounded text-sm" />
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded text-sm">{t('tournamentDetail.addRoundSubmit')}</button>
            </form>
          )}

          {tournament.rounds?.length === 0 ? (
            <p className="text-gray-400 text-sm">{t('tournamentDetail.noRounds')}</p>
          ) : (
            <div className="space-y-3">
              {tournament.rounds?.map((r, i) => (
                <div key={r.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-gray-500">{t('tournamentDetail.roundNumber', { n: r.round_number })}</span>
                      <h3 className="font-medium">{r.name}</h3>
                      <p className="text-xs text-gray-400">
                        {t('tournamentDetail.roundMeta', { type: r.round_type, dur: r.duration_seconds, count: r.puzzles?.length || 0 })}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      r.status === 'NOT_STARTED' ? 'bg-gray-100 text-gray-600' :
                      r.status === 'IN_PROGRESS' ? 'bg-green-100 text-green-700' :
                      r.status === 'PAUSED' ? 'bg-orange-100 text-orange-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{t(`common.status.${r.status}`)}</span>
                  </div>
                  {isAdmin && r.puzzles?.length === 0 && tournament.status === 'PENDING' && (
                    <button onClick={() => handleGenerateAndImport(r.id, r.round_type)}
                      disabled={generatingRoundId === r.id}
                      className="mt-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs disabled:opacity-50">
                      {generatingRoundId === r.id ? t('tournamentDetail.importing') : t('tournamentDetail.importFromBank')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Teams Section */}
        <section className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{t('tournamentDetail.teamsTitle')} ({tournament.teams?.length || 0})</h2>
            {isAdmin && tournament.status === 'PENDING' && (
              <div className="flex gap-2">
                <button onClick={() => setShowAddTeam(!showAddTeam)}
                  className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-500">
                  {t('tournamentDetail.addTeam')}
                </button>
                <button onClick={handleAssignJudge}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-500">
                  {t('tournamentDetail.assignJudge')}
                </button>
              </div>
            )}
          </div>

          {showAddTeam && (
            <form onSubmit={handleCreateTeam} className="bg-gray-50 rounded-lg p-4 mb-4 flex gap-2">
              <input type="text" placeholder={t('tournamentDetail.teamNamePlaceholder')} value={teamName} onChange={e => setTeamName(e.target.value)}
                className="flex-1 px-3 py-2 border rounded text-sm" required />
              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded text-sm">{t('tournamentDetail.addTeamSubmit')}</button>
            </form>
          )}

          {tournament.teams?.length === 0 ? (
            <p className="text-gray-400 text-sm">{t('tournamentDetail.noTeams')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {tournament.teams?.map(team => (
                <div key={team.id} className="border rounded-lg p-4">
                  <h3 className="font-medium">{team.name}</h3>
                  <p className="text-xs text-gray-400 mb-2">{t('tournamentDetail.memberCount', { count: team.member_count || team.members?.length || 0 })}</p>
                  {team.members?.map(m => (
                    <span key={m.id} className="inline-block bg-gray-100 rounded px-2 py-0.5 text-xs mr-1 mb-1">
                      {m.display_name || m.username}
                    </span>
                  ))}
                  {isAdmin && tournament.status === 'PENDING' && (
                    <div className="mt-2 flex gap-1">
                      <select onChange={e => setSelectedPlayer(e.target.value)} value={selectedPlayer}
                        className="flex-1 px-2 py-1 border rounded text-xs">
                        <option value="">{t('tournamentDetail.addPlayer')}</option>
                        {users.filter(u => u.role === 'PLAYER').map(u => (
                          <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
                        ))}
                      </select>
                      <button onClick={() => handleAddMember(team.id)}
                        className="px-2 py-1 bg-green-600 text-white rounded text-xs">+</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Judges */}
        {tournament.judges?.length > 0 && (
          <section className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">{t('tournamentDetail.judgesTitle')}</h2>
            <div className="flex gap-2">
              {tournament.judges.map(j => (
                <span key={j.id} className="bg-blue-100 text-blue-700 rounded-full px-3 py-1 text-sm">
                  {j.display_name || j.username}
                </span>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
