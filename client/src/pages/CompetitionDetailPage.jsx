import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { api } from '../api';
import ParticipantImport from '../components/ParticipantImport';
import AccessLinkSection from '../components/AccessLinkSection';
import PublishPanel from '../components/PublishPanel';

export default function CompetitionDetailPage() {
  const { id } = useParams();
  const { user, isAdmin } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [competition, setCompetition] = useState(null);
  const [users, setUsers] = useState([]);
  const [statusMsg, setStatusMsg] = useState(null);
  const [showParticipantImport, setShowParticipantImport] = useState(false);
  const [participants, setParticipants] = useState([]);

  const msg = (text, type = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 5000);
  };

  const [stages, setStages] = useState([]);
  const [showAddStage, setShowAddStage] = useState(false);
  const [openStageId, setOpenStageId] = useState(null);
  const [roundTypes, setRoundTypes] = useState({});
  const [roundTypesError, setRoundTypesError] = useState(null);
  const [roundForm, setRoundForm] = useState({ name: '', roundType: '', durationSeconds: 600, pdf: null });

  const load = async () => {
    const res = await api.getCompetition(id);
    if (res.code === 200) setCompetition(res.data);
  };

  const loadStages = async () => {
    const res = await api.listStages(id);
    if (res.code === 200) setStages(res.data || []);
    else msg(t('competitionDetail.stageAddFailed', { msg: res.message || res.code }), 'error');
  };

  const loadParticipants = async () => {
    const res = await api.listParticipants(id);
    if (res.code === 200) setParticipants(res.data || []);
  };

  useEffect(() => {
    load();
    loadStages();
    if (isAdmin) {
      api.listUsers().then(res => { if (res.code === 200) setUsers(res.data); });
      loadParticipants();
      // Fetched rather than hardcoded: the server owns the stage → round type
      // mapping (engine/RoundTypes.js), and it also validates against it.
      //
      // A failure here must be told apart from "this stage category has no
      // round type". Both leave the list empty, but only one is normal — and
      // reporting the wrong one sends the reader looking in the wrong place.
      api.getRoundTypes().then(res => {
        if (res.code === 200) {
          setRoundTypes(res.data || {});
          setRoundTypesError(null);
        } else {
          setRoundTypesError(res.message || String(res.code));
        }
      });
    }
  }, [id]);

  // Opening a stage resets the form, so the type dropdown starts on a value
  // that this stage actually accepts.
  const toggleStage = (stage) => {
    if (openStageId === stage.id) return setOpenStageId(null);
    setOpenStageId(stage.id);
    setRoundForm({
      name: '',
      roundType: (roundTypes[stage.type] || [])[0] || '',
      durationSeconds: 600,
      pdf: null,
    });
  };

  const handleCreateRound = async (e, stage) => {
    e.preventDefault();
    const res = await api.createStageRound(id, stage.id, {
      name: roundForm.name,
      roundType: roundForm.roundType,
      durationSeconds: roundForm.durationSeconds,
    });
    if (res.code === 200) {
      setRoundForm(f => ({ ...f, name: '', pdf: null }));
      loadStages();
      msg(t('competitionDetail.roundAdded'));
    } else {
      msg(t('competitionDetail.roundAddFailed', { msg: res.message || res.code }), 'error');
    }
  };

  // Stages can only be changed while the competition is being prepared. The
  // server enforces the same rule (GameOrchestrator.configureStages refuses
  // RUNNING and FINISHED); this only decides whether the controls are shown.
  const isEditable = competition?.status === 'DRAFT' || competition?.status === 'PUBLISHED';

  const STAGE_TYPES = [
    { value: 'INDIVIDUAL', labelKey: 'competitionDetail.stageTypeIndividual', available: true },
    { value: 'TEAM', labelKey: 'competitionDetail.stageTypeTeam', available: true },
    // The engine accepts a PK stage, but RoundTypes.js defines no PK round
    // type yet — such a stage could never hold a single round. Offered but
    // disabled, so the roadmap is visible without producing a dead end.
    { value: 'PK', labelKey: 'competitionDetail.stageTypePK', available: false },
  ];

  // configureStages is declarative: it replaces the whole list. Existing
  // stages must be sent back with their id, or the server deletes them along
  // with their rounds.
  const submitStages = async (nextStages) => {
    return api.configureStages(id, nextStages.map((s, i) => ({
      ...(s.id ? { id: s.id } : {}),
      type: s.type,
      orderNumber: i + 1,
    })));
  };

  const handleAddStage = async (type) => {
    const label = t(STAGE_TYPES.find(s => s.value === type).labelKey);
    const res = await submitStages([...stages, { type }]);
    if (res.code === 200) {
      setStages(res.data || []);
      setShowAddStage(false);
      msg(t('competitionDetail.stageAdded', { type: label }));
    } else {
      msg(t('competitionDetail.stageAddFailed', { msg: res.message || res.code }), 'error');
    }
  };

  const handleRemoveStage = async (stageId) => {
    // The server refuses an empty list ("at least one stage"), which would
    // surface as a puzzling error. Say it plainly instead.
    if (stages.length <= 1) return msg(t('competitionDetail.lastStageKept'), 'error');
    if (!window.confirm(t('competitionDetail.confirmRemoveStage'))) return;
    const res = await submitStages(stages.filter(s => s.id !== stageId));
    if (res.code === 200) {
      setStages(res.data || []);
      msg(t('competitionDetail.stageRemoved'));
    } else {
      msg(t('competitionDetail.stageRemoveFailed', { msg: res.message || res.code }), 'error');
    }
  };

  const handleAssignJudge = async () => {
    const judge = users.find(u => u.role === 'JUDGE');
    if (!judge) return msg(t('competitionDetail.judgeNotFound'), 'error');
    const res = await api.assignJudge(id, judge.id);
    if (res.code === 200) { msg(t('competitionDetail.judgeAssigned')); load(); }
    else msg(res.message || t('competitionDetail.assignJudgeFailed'), 'error');
  };

  const handleDeleteParticipants = async () => {
    if (!window.confirm(t('competitionDetail.confirmDeleteParticipants'))) return;
    const res = await api.deleteParticipants(id);
    if (res.code === 200) {
      msg(t('competitionDetail.deleteSuccess') + ': ' + t('competitionDetail.deletedCount') + ' ' + (res.data?.deleted || 0));
      loadParticipants();
    } else {
      msg(res.message || 'Delete failed', 'error');
    }
  };

  const handleExportParticipants = async () => {
    try {
      const result = await api.exportParticipants(id);
      if (result.success) {
        msg(t('competitionDetail.exportSuccess'));
      } else {
        msg(result.message || t('competitionDetail.exportFailed'), 'error');
      }
    } catch (err) {
      msg(err.message || t('competitionDetail.exportFailed'), 'error');
    }
  };

  // The Start button now lives inside PublishPanel — it is enabled only when
  // the server says publishable, which is the same condition Publish uses.
  // Keeping Start next to Publish makes the dependency obvious: you cannot
  // start what you have not published.

  const isPlayer = user?.role === 'PLAYER';

  if (!competition) return <div className="flex items-center justify-center h-screen p-4 text-center text-sm sm:text-base">{t('common.loading')}</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600 text-sm sm:text-base">&larr; {t('competitionDetail.back')}</button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-gray-800">{competition.name}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                competition.status === 'DRAFT' ? 'bg-gray-100 text-gray-700' :
                competition.status === 'PUBLISHED' ? 'bg-blue-100 text-blue-700' :
                competition.status === 'RUNNING' ? 'bg-green-100 text-green-700' :
                competition.status === 'FINISHED' ? 'bg-gray-200 text-gray-600' :
                competition.status === 'PAUSED' ? 'bg-orange-100 text-orange-700' :
                'bg-gray-100 text-gray-700'
              }`}>{t(`common.status.${competition.status}`)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LanguageSwitcher />
            {isPlayer && competition.status === 'IN_PROGRESS' && (
              <button onClick={() => navigate(`/play/${id}`)}
                className="px-3 sm:px-4 py-2 bg-green-600 text-white rounded-lg text-xs sm:text-sm hover:bg-green-500">
                {t('competitionDetail.enterGame')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Status Message */}
        {statusMsg && (
          <div className={`px-4 py-3 rounded-lg text-xs sm:text-sm ${
            statusMsg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
            'bg-green-50 text-green-700 border border-green-200'
          }`}>{statusMsg.text}</div>
        )}

        {/* PublishPanel — the single, up-to-date readiness panel. Replaces
            the v1 "ready to start" block that hardcoded three rounds and a
            team. The rule is recomputed server-side on every publish call;
            this panel only displays. Shown to admins only — a judge or
            player on this page never sees it, so they never hit a 403 on
            the publishability GET. */}
        {isAdmin && (
          <PublishPanel
            competitionId={id}
            status={competition.status}
          />
        )}

        {/* Stages Section — a competition is a sequence of stages, each of
            which will hold its own rounds. This replaces the flat Rounds and
            Teams lists: rounds belong to a stage, and teams only make sense
            inside a TEAM stage. */}
        <section className="bg-white rounded-xl shadow p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
            <h2 className="text-base sm:text-lg font-semibold">
              {t('competitionDetail.stagesTitle')} ({stages.length})
            </h2>
            {isAdmin && isEditable && (
              <button onClick={() => setShowAddStage(!showAddStage)}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs sm:text-sm hover:bg-indigo-500">
                {t('competitionDetail.addStage')}
              </button>
            )}
          </div>

          {isAdmin && !isEditable && (
            <p className="text-xs sm:text-sm text-gray-400 mb-3">{t('competitionDetail.stagesLocked')}</p>
          )}

          {showAddStage && isEditable && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {STAGE_TYPES.map(st => (
                <button key={st.value} type="button"
                  onClick={() => st.available && handleAddStage(st.value)}
                  disabled={!st.available}
                  title={st.available ? undefined : t('competitionDetail.stageTypePKDisabled')}
                  className={`border rounded-lg p-3 text-left transition-colors ${
                    st.available
                      ? 'bg-white hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer'
                      : 'bg-gray-100 text-gray-400 border-dashed cursor-not-allowed'
                  }`}>
                  <span className="block font-medium text-xs sm:text-sm">{t(st.labelKey)}</span>
                  {!st.available && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 text-[10px]">
                      {t('competitionDetail.stageTypePKSoon')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {stages.length === 0 ? (
            <p className="text-gray-400 text-xs sm:text-sm">{t('competitionDetail.noStages')}</p>
          ) : (
            <div className="space-y-3">
              {stages.map((stage, i) => {
                const allowedTypes = roundTypes[stage.type] || [];
                const isOpen = openStageId === stage.id;
                return (
                  <div key={stage.id} className="border rounded-lg p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs sm:text-sm text-gray-500">
                          {t('competitionDetail.stageNumber', { n: stage.order_number ?? i + 1 })}
                        </span>
                        <h3 className="font-medium text-sm sm:text-base">
                          {t(`competitionDetail.stageType${stage.type === 'INDIVIDUAL' ? 'Individual' : stage.type === 'TEAM' ? 'Team' : 'PK'}`)}
                        </h3>
                        <p className="text-xs text-gray-400">
                          {t('competitionDetail.stageRoundCount', { count: stage.rounds?.length || 0 })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => toggleStage(stage)}
                          className="px-3 py-1 border rounded text-xs sm:text-sm hover:bg-gray-50">
                          {isOpen ? t('competitionDetail.closeStage') : t('competitionDetail.configureStage')}
                        </button>
                        {isAdmin && isEditable && (
                          <button onClick={() => handleRemoveStage(stage.id)}
                            className="px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded text-xs sm:text-sm">
                            {t('competitionDetail.removeStage')}
                          </button>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        <h4 className="text-xs sm:text-sm font-medium text-gray-600">
                          {t('competitionDetail.stageRoundsTitle')}
                        </h4>

                        {stage.rounds?.length ? (
                          <ol className="space-y-2">
                            {stage.rounds.map(r => (
                              <li key={r.id} className="bg-gray-50 rounded p-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <span className="text-xs sm:text-sm">
                                  <span className="text-gray-500">{t('competitionDetail.roundNumber', { n: r.order_number })}</span>
                                  {' '}<span className="font-medium">{r.name}</span>
                                </span>
                                <span className="text-xs text-gray-400">
                                  {t('competitionDetail.roundMeta', { type: r.type, dur: r.duration_seconds, count: r.puzzles?.length || 0 })}
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-gray-400 text-xs sm:text-sm">{t('competitionDetail.noRoundsInStage')}</p>
                        )}

                        {isAdmin && isEditable && (
                          roundTypesError ? (
                            <p className="text-xs sm:text-sm text-red-600">
                              {t('competitionDetail.roundTypesUnavailable', { msg: roundTypesError })}
                            </p>
                          ) : allowedTypes.length === 0 ? (
                            <p className="text-xs sm:text-sm text-gray-400">{t('competitionDetail.noRoundTypeForStage')}</p>
                          ) : (
                            <form onSubmit={(e) => handleCreateRound(e, stage)} className="bg-gray-50 rounded-lg p-3 space-y-2">
                              <input type="text" placeholder={t('competitionDetail.roundName')} value={roundForm.name}
                                onChange={e => setRoundForm({ ...roundForm, name: e.target.value })}
                                className="w-full px-3 py-2 border rounded text-xs sm:text-sm" required />

                              {/* Only the types this stage category accepts. The
                                  server enforces the same rule, so a mismatch is
                                  refused even if the list were tampered with. */}
                              <select value={roundForm.roundType} aria-label={t('competitionDetail.roundType')}
                                onChange={e => setRoundForm({ ...roundForm, roundType: e.target.value })}
                                className="w-full px-3 py-2 border rounded text-xs sm:text-sm">
                                {allowedTypes.map(rt => (
                                  <option key={rt} value={rt}>{t(`common.roundName.${rt}`)}</option>
                                ))}
                              </select>

                              <input type="number" min="1" aria-label={t('competitionDetail.roundDuration')}
                                placeholder={t('competitionDetail.roundDuration')} value={roundForm.durationSeconds}
                                onChange={e => setRoundForm({ ...roundForm, durationSeconds: parseInt(e.target.value) || 600 })}
                                className="w-full px-3 py-2 border rounded text-xs sm:text-sm" />

                              {/* PDF import is not built: the extraction pipeline
                                  cannot be designed without a sample file (see
                                  DEVELOPMENT_PLAN, open question 9). The field is
                                  shown disabled rather than hidden, so the step is
                                  visible without pretending to work. */}
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">{t('competitionDetail.roundPdf')}</label>
                                <input type="file" accept="application/pdf" disabled
                                  className="w-full text-xs text-gray-400 cursor-not-allowed" />
                                <p className="text-xs text-gray-400 mt-1">{t('competitionDetail.roundPdfHint')}</p>
                              </div>

                              <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded text-xs sm:text-sm">
                                {t('competitionDetail.addRoundSubmit')}
                              </button>
                            </form>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Participants Section */}
        {isAdmin && (
          <section className="bg-white rounded-xl shadow p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
              <h2 className="text-base sm:text-lg font-semibold">
                {t('competitionDetail.participantsTitle')} ({participants.length})
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowParticipantImport(!showParticipantImport)}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs sm:text-sm hover:bg-purple-500"
                >
                  {t('competitionDetail.participantImport')}
                </button>
                {participants.length > 0 && (
                  <>
                    <button
                      onClick={handleExportParticipants}
                      className="px-3 py-1.5 bg-green-600 text-white rounded text-xs sm:text-sm hover:bg-green-500"
                    >
                      {t('competitionDetail.exportCredentials')}
                    </button>
                    <button
                      onClick={handleDeleteParticipants}
                      className="px-3 py-1.5 bg-red-600 text-white rounded text-xs sm:text-sm hover:bg-red-500"
                    >
                      {t('competitionDetail.deleteParticipants')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {showParticipantImport && (
              <div className="mb-4">
                <ParticipantImport
                  competitionId={id}
                  onImportComplete={() => {
                    setShowParticipantImport(false);
                    loadParticipants();
                  }}
                />
              </div>
            )}

            {participants.length === 0 ? (
              <p className="text-gray-400 text-xs sm:text-sm">{t('competitionDetail.noParticipants')}</p>
            ) : (
              <div className="max-h-96 overflow-auto border border-gray-200 rounded">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-1 sm:px-2 py-1 text-left">#</th>
                      <th className="px-1 sm:px-2 py-1 text-left hidden sm:table-cell">{t('competitionDetail.province')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left hidden md:table-cell">{t('competitionDetail.city')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left hidden md:table-cell">{t('competitionDetail.district')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left">{t('competitionDetail.school')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left">{t('competitionDetail.studentName')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left hidden sm:table-cell">{t('competitionDetail.age')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left hidden lg:table-cell">{t('competitionDetail.category')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left">{t('competitionDetail.teamName')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left hidden lg:table-cell">{t('competitionDetail.account')}</th>
                      <th className="px-1 sm:px-2 py-1 text-left hidden lg:table-cell">{t('competitionDetail.passwordCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map((p, idx) => (
                      <tr key={p.id} className="border-b hover:bg-gray-50">
                        <td className="px-1 sm:px-2 py-1">{idx + 1}</td>
                        <td className="px-1 sm:px-2 py-1 hidden sm:table-cell">{p.province || '-'}</td>
                        <td className="px-1 sm:px-2 py-1 hidden md:table-cell">{p.city || '-'}</td>
                        <td className="px-1 sm:px-2 py-1 hidden md:table-cell">{p.district || '-'}</td>
                        <td className="px-1 sm:px-2 py-1">{p.school_name}</td>
                        <td className="px-1 sm:px-2 py-1">{p.name}</td>
                        <td className="px-1 sm:px-2 py-1 hidden sm:table-cell">{p.age || '-'}</td>
                        <td className="px-1 sm:px-2 py-1 hidden lg:table-cell">{p.category || '-'}</td>
                        <td className="px-1 sm:px-2 py-1">{p.team_name || '-'}</td>
                        <td className="px-1 sm:px-2 py-1 hidden lg:table-cell font-mono">{p.account || '-'}</td>
                        <td className="px-1 sm:px-2 py-1 hidden lg:table-cell font-mono">{p.password || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Judges — the "assign a judge" control used to sit in the Teams
            section. That section is gone (teams now belong to a TEAM stage),
            so the control moved here, next to the list it acts on. */}
        <section className="bg-white rounded-xl shadow p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
            <h2 className="text-base sm:text-lg font-semibold">{t('competitionDetail.judgesTitle')}</h2>
            {isAdmin && isEditable && (
              <button onClick={handleAssignJudge}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs sm:text-sm hover:bg-blue-500">
                {t('competitionDetail.assignJudge')}
              </button>
            )}
          </div>
          {competition.judges?.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {competition.judges.map(j => (
                <span key={j.id} className="bg-blue-100 text-blue-700 rounded-full px-3 py-1 text-xs sm:text-sm">
                  {j.display_name || j.username}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-xs sm:text-sm">{t('competitionDetail.noJudges')}</p>
          )}
        </section>

        {/* Access link — the server already generates/reads/revokes the entry
            code; this block is the missing UI. Shown to admins only because
            the underlying routes are gated on ORG_ADMIN / SUPER_ADMIN. A judge
            on this page never sees it, so they never hit a 403. */}
        {isAdmin && (
          <AccessLinkSection
            competitionId={id}
            /* Publishing unlocks link generation; it does not perform it. A
               DRAFT is still being configured, so its entry URL must not exist
               yet. Anything past DRAFT (PUBLISHED, RUNNING, FINISHED) may hold
               a link — a running competition still needs a reachable URL for a
               player who lost theirs. The server refuses on DRAFT regardless;
               this only keeps the button honest. */
            canGenerate={!!competition && competition.status !== 'DRAFT'}
          />
        )}
      </main>
    </div>
  );
}
