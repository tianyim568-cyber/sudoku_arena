import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { api } from '../api';

export default function JudgeControlPage() {
  // The URL param is still named :competitionId (Phase 13 will rename the route).
  // We alias it locally to competitionId to match the api function signatures.
  const { competitionId } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [competition, setCompetition] = useState(null);
  const [roomStatus, setRoomStatus] = useState(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const res = await api.getCompetition(competitionId);
    if (res.code === 200) setCompetition(res.data);
  };

  const loadRoomStatus = async () => {
    const res = await api.getRoomStatus(competitionId);
    if (res.code === 200) setRoomStatus(res.data);
  };

  useEffect(() => { load(); }, [competitionId]);
  useEffect(() => {
    if (competition?.status === 'IN_PROGRESS' || competition?.status === 'PAUSED') {
      loadRoomStatus();
      const iv = setInterval(loadRoomStatus, 5000);
      return () => clearInterval(iv);
    }
  }, [competition?.status]);

  const handleAction = async (action, ...args) => {
    try {
      let res;
      switch (action) {
        case 'start': res = await api.startCompetition(competitionId); break;
        case 'pause': res = await api.pauseCompetition(competitionId); break;
        case 'resume': res = await api.resumeCompetition(competitionId); break;
        case 'end': res = await api.endCompetition(competitionId); break;
        case 'startRound': res = await api.startRound(competitionId, args[0]); break;
        case 'endRound': res = await api.endRound(competitionId, args[0]); break;
      }
      if (res.code === 200) {
        setMessage(t('judge.actionSuccess', { action }));
        load();
        loadRoomStatus();
      } else {
        setMessage(t('judge.actionError', { msg: res.message }));
      }
    } catch (e) {
      setMessage(t('judge.actionError', { msg: e.message }));
    }
  };

  const formatTime = (seconds) => {
    if (seconds == null) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!competition) return <div className="flex items-center justify-center h-screen p-4 text-center text-sm sm:text-base">{t('common.loading')}</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gray-800 text-white px-4 sm:px-6 py-3 sm:py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <button onClick={() => navigate(`/competitions/${competitionId}`)} className="text-gray-400 hover:text-white text-xs sm:text-sm">&larr; {t('judge.back')}</button>
            <div>
              <h1 className="text-base sm:text-lg font-bold">{competition.name}</h1>
              <span className="text-xs sm:text-sm text-gray-400">{t('judge.console')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            <span className={`px-2 sm:px-3 py-1 rounded text-xs sm:text-sm font-medium ${
              competition.status === 'PENDING' ? 'bg-yellow-600' :
              competition.status === 'IN_PROGRESS' ? 'bg-green-600' :
              competition.status === 'PAUSED' ? 'bg-orange-600' : 'bg-gray-600'
            }`}>{t(`common.status.${competition.status}`)}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
        {message && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 sm:px-4 py-2 text-blue-700 text-xs sm:text-sm">{message}</div>
        )}

        {/* Competition Controls */}
        <section className="bg-white rounded-xl shadow p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t('judge.competitionControl')}</h2>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {competition.status === 'PENDING' && (
              <button onClick={() => handleAction('start')}
                className="px-4 sm:px-6 py-2 sm:py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors text-sm sm:text-base">
                {t('judge.startCompetition')}
              </button>
            )}
            {competition.status === 'IN_PROGRESS' && (
              <>
                <button onClick={() => handleAction('pause')}
                  className="px-4 sm:px-6 py-2 sm:py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-medium transition-colors text-sm sm:text-base">
                  {t('judge.pause')}
                </button>
                <button onClick={() => handleAction('end')}
                  className="px-4 sm:px-6 py-2 sm:py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors text-sm sm:text-base">
                  {t('judge.endCompetition')}
                </button>
              </>
            )}
            {competition.status === 'PAUSED' && (
              <button onClick={() => handleAction('resume')}
                className="px-4 sm:px-6 py-2 sm:py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors text-sm sm:text-base">
                {t('judge.resume')}
              </button>
            )}
          </div>
        </section>

        {/* Round Controls */}
        <section className="bg-white rounded-xl shadow p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t('judge.roundControl')}</h2>
          <div className="space-y-2 sm:space-y-3">
            {competition.rounds?.map((r, i) => (
              <div key={r.id} className="border rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <h3 className="font-medium text-sm sm:text-base">{t('judge.roundTitle', { n: r.order_number, name: r.name })}</h3>
                  <p className="text-xs sm:text-sm text-gray-500">{t('judge.roundMeta', { type: r.type, dur: r.duration_seconds, count: r.puzzles?.length || 0 })}</p>
                  {r.remaining_seconds != null && r.status === 'IN_PROGRESS' && (
                    <p className="text-base sm:text-lg font-mono mt-1 text-blue-600">{formatTime(r.remaining_seconds)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    r.status === 'NOT_STARTED' ? 'bg-gray-100 text-gray-600' :
                    r.status === 'IN_PROGRESS' ? 'bg-green-100 text-green-700' :
                    r.status === 'PAUSED' ? 'bg-orange-100 text-orange-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>{t(`common.status.${r.status}`)}</span>
                  {competition.status === 'IN_PROGRESS' && r.status === 'NOT_STARTED' && (
                    <button onClick={() => handleAction('startRound', r.id)}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 bg-green-600 hover:bg-green-500 text-white rounded text-xs sm:text-sm">
                      {t('judge.startRound')}
                    </button>
                  )}
                  {r.status === 'IN_PROGRESS' && (
                    <button onClick={() => handleAction('endRound', r.id)}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 bg-red-600 hover:bg-red-500 text-white rounded text-xs sm:text-sm">
                      {t('judge.endRound')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Room Status */}
        {roomStatus && (
          <section className="bg-white rounded-xl shadow p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t('judge.roomStatus')}</h2>
            {roomStatus.currentRound && (
              <p className="text-xs sm:text-sm text-gray-600 mb-3 sm:mb-4">
                {t('judge.currentRound')}<span className="font-medium">{roomStatus.currentRound.name}</span>
                {' '}({t('judge.remaining', { time: formatTime(roomStatus.currentRound.remaining_seconds) })})
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {roomStatus.teams?.map(team => (
                <div key={team.id} className="border rounded-lg p-3 sm:p-4">
                  <h3 className="font-medium text-gray-800 text-sm sm:text-base">{team.name}</h3>
                  <div className="mt-2 space-y-1">
                    {team.members?.map(m => (
                      <div key={m.id} className="flex items-center gap-2 text-xs sm:text-sm">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-gray-600">{m.display_name || m.username}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Scores */}
        <section className="bg-white rounded-xl shadow p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t('judge.teamScores')}</h2>
          <button onClick={async () => {
            const res = await api.getTeamScores(competitionId);
            if (res.code === 200) setRoomStatus(prev => ({ ...prev, scores: res.data }));
          }} className="px-3 sm:px-4 py-1.5 sm:py-2 bg-indigo-600 text-white rounded text-xs sm:text-sm mb-3 sm:mb-4">
            {t('judge.refreshScores')}
          </button>
          {roomStatus?.scores && roomStatus.scores.length > 0 ? (
            <div className="space-y-2">
              {roomStatus.scores.map(s => (
                <div key={s.id} className="flex items-center justify-between border-b pb-2">
                  <span className="font-medium text-sm sm:text-base">{s.team_name}</span>
                  <span className="text-base sm:text-lg font-bold text-indigo-600">{t('judge.points', { n: s.total_points })}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-xs sm:text-sm">{t('judge.noScores')}</p>
          )}
        </section>
      </main>
    </div>
  );
}
