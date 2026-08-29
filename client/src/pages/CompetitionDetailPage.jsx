import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { api } from '../api';
import ParticipantImport from '../components/ParticipantImport';
import AccessLinkSection from '../components/AccessLinkSection';
import DisplayTokenSection from '../components/DisplayTokenSection';
import PublishPanel from '../components/PublishPanel';
import RoundPdfImport from '../components/RoundPdfImport';
import RoundBankImport from '../components/RoundBankImport';
import ConfirmDialog from '../components/ConfirmDialog';

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
  // Credentials captured from the /confirm response — plain-text passwords
  // live only in memory. The admin can click "Export credentials" on the
  // page (not just inside the import panel) as long as they haven't
  // navigated away. Lost on page change or browser refresh — by design,
  // since the DB never stores plain-text passwords. See option B (2026-08-26).
  const [credentials, setCredentials] = useState(null);
  const [exporting, setExporting] = useState(false);

  const msg = useCallback((text, type = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 5000);
  }, []);

  const [stages, setStages] = useState([]);
  const [showAddStage, setShowAddStage] = useState(false);
  const [openStageId, setOpenStageId] = useState(null);
  // Which stage currently shows the round creation form (null = no form).
  // Separated from openStageId so the stage can be expanded (showing the
  // rounds list) without the form cluttering the view.
  const [openRoundFormStageId, setOpenRoundFormStageId] = useState(null);
  const [roundTypes, setRoundTypes] = useState({});
  const [roundTypesError, setRoundTypesError] = useState(null);
  const [roundForm, setRoundForm] = useState({ name: '', roundType: '', durationSeconds: 600, preparationSeconds: 10, pdf: null });
  // Draft round created when admin opens the "Add round" form — allows import
  // buttons to work immediately without waiting for form submission.
  const [draftRound, setDraftRound] = useState(null);
  // CRUD-Rounds (2026-08-26): inline edit mode for a single round. Null when
  // no round is being edited; a round id when the edit form replaces the
  // read-only row. editForm holds the live values of the form.
  const [editingRoundId, setEditingRoundId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', durationSeconds: 600, preparationSeconds: 10 });
  // Louise UX 2026-08-26: replace window.confirm() with a styled modal.
  // One state object serves all three confirmations (delete round, delete
  // stage, delete participants) — the dialog is presentational, the parent
  // swaps the props. `action` is a function reference run on confirm, so the
  // dialog stays generic.
  const [confirm, setConfirm] = useState(null);
  // BUG-01 fix: the admin must pick which judge to assign, not always take
  // the first one from users.find(...). The dropdown is populated from users
  // filtered against competition.judges so an already-assigned judge cannot
  // be picked twice.
  const [selectedJudgeId, setSelectedJudgeId] = useState('');
  // Create & Assign judge: admin types a name, the system generates credentials
  const [newJudgeName, setNewJudgeName] = useState('');
  const [creatingJudge, setCreatingJudge] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false);
  // BUG-02 fix: PublishPanel only refetches on status prop change. Adding
  // a stage after publication does NOT change the status, so the checklist
  // went stale until a manual page reload. This counter increments on every
  // successful mutation of sibling panels and is passed to PublishPanel as
  // refreshKey — the panel adds it to its useEffect deps.
  const [publishRefreshKey, setPublishRefreshKey] = useState(0);
  const bumpPublishRefresh = useCallback(() => setPublishRefreshKey(k => k + 1), []);

  const load = useCallback(async () => {
    const res = await api.getCompetition(id);
    if (res.code === 200) setCompetition(res.data);
  }, [id]);

  // BUG-02 fix: every successful mutation of sibling panels bumps the
  // publishRefreshKey so PublishPanel refetches its checklist. loadStages
  // is called after add/remove stage and after create round; both change
  // the publishability (a new empty stage flips "every stage configured"
  // to red, a new round with puzzles flips it back).
  const loadStages = useCallback(async () => {
    const res = await api.listStages(id);
    if (res.code === 200) {
      setStages(res.data || []);
      bumpPublishRefresh();
    } else {
      msg(t('competitionDetail.stageAddFailed', { msg: res.message || res.code }), 'error');
    }
  }, [id, t, msg, bumpPublishRefresh]);

  const loadParticipants = useCallback(async () => {
    const res = await api.listParticipants(id);
    if (res.code === 200) {
      setParticipants(res.data || []);
      // Participant count affects the "Has participants" check — bump.
      bumpPublishRefresh();
    }
  }, [id, bumpPublishRefresh]);

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
  }, [id, isAdmin, load, loadStages, loadParticipants]);

  // Opening a stage resets the form, so the type dropdown starts on a value
  // that this stage actually accepts. Closing the stage also closes the form.
  const toggleStage = (stage) => {
    if (openStageId === stage.id) {
      setOpenStageId(null);
      setOpenRoundFormStageId(null);
      setEditingRoundId(null);
      setCreatedDraftRound(null);
      setDraftRound(null);
      return;
    }
    setOpenStageId(stage.id);
    setOpenRoundFormStageId(null);
    setEditingRoundId(null);
    setCreatedDraftRound(null);
    setDraftRound(null);
    setRoundForm({
      name: '',
      roundType: (roundTypes[stage.type] || [])[0] || '',
      durationSeconds: 600,
      preparationSeconds: 10,
      pdf: null,
    });
  };

  // Open the "add round" form and create a DRAFT round immediately so the
  // import buttons (PDF + bank) are visible and functional from the start.
  // Admin can edit fields + import puzzles in one flow.
  const handleOpenAddRoundForm = async (stage) => {
    const defaultType = (roundTypes[stage.type] || [])[0] || '';
    const res = await api.createStageRound(id, stage.id, {
      name: 'New Round',
      roundType: defaultType,
      durationSeconds: 600,
      preparationSeconds: 10,
      status: 'DRAFT',
    });
    if (res.code === 200) {
      setDraftRound(res.data);
      setRoundForm({
        name: res.data.name,
        roundType: res.data.roundType || defaultType,
        durationSeconds: res.data.durationSeconds || 600,
        preparationSeconds: res.data.preparationSeconds || 10,
        pdf: null,
      });
      setOpenRoundFormStageId(stage.id);
      loadStages();
    } else {
      msg(t('competitionDetail.roundAddFailed', { msg: res.message || res.code }), 'error');
    }
  };

  // Update the DRAFT round with the current form values. Called when admin
  // clicks "Save" in the creation form — saves fields + closes the form.
  const handleSaveDraftRound = async (e, stage) => {
    e.preventDefault();
    if (!draftRound) return;
    const res = await api.updateStageRound(id, stage.id, draftRound.id, {
      name: roundForm.name,
      roundType: roundForm.roundType,
      durationSeconds: roundForm.durationSeconds,
      preparationSeconds: roundForm.preparationSeconds,
    });
    if (res.code === 200) {
      setDraftRound(null);
      setOpenRoundFormStageId(null);
      loadStages();
      msg(t('competitionDetail.roundAdded'));
    } else {
      msg(t('competitionDetail.roundAddFailed', { msg: res.message || res.code }), 'error');
    }
  };

  // Cancel the round form: if the admin has unsaved changes, offer to save
  // as DRAFT so they can finish later. Otherwise close immediately.
  const handleCancelRoundForm = (stage) => {
    const hasChanges = roundForm.name || roundForm.pdf;
    if (!hasChanges) {
      setOpenRoundFormStageId(null);
      return;
    }
    setConfirm({
      title: t('competitionDetail.cancelRoundFormTitle'),
      message: t('competitionDetail.cancelRoundFormMessage'),
      confirmLabel: t('competitionDetail.cancelRoundFormSave'),
      cancelLabel: t('competitionDetail.cancelRoundFormDiscard'),
      danger: false,
      action: async () => {
        // Save as DRAFT round
        const res = await api.createStageRound(id, stage.id, {
          name: roundForm.name || t('competitionDetail.unnamedRound'),
          roundType: roundForm.roundType,
          durationSeconds: roundForm.durationSeconds,
          preparationSeconds: roundForm.preparationSeconds,
          status: 'DRAFT',
        });
        if (res.code === 200) {
          setRoundForm(f => ({ ...f, name: '', pdf: null }));
          setOpenRoundFormStageId(null);
          loadStages();
          msg(t('competitionDetail.roundSavedAsDraft'));
        } else {
          msg(t('competitionDetail.roundAddFailed', { msg: res.message || res.code }), 'error');
        }
      },
    });
  };

  // CRUD-Rounds (2026-08-26): delete a round. The server cascades
  // round_puzzles and round_rankings automatically (schema-level onDelete:
  // Cascade). player_round_sessions has onDelete: NoAction, so the route
  // refuses to delete a round that has already started (status !== WAITING).
  // We double-confirm client-side when the round holds puzzles, so the admin
  // sees the blast radius before the irreversible call.
  const handleDeleteRound = async (stage, round) => {
    const puzzleCount = round.puzzles?.length || 0;
    const confirmMsg = puzzleCount > 0
      ? t('competitionDetail.deleteRoundConfirmWithPuzzles', { n: puzzleCount })
      : t('competitionDetail.deleteRoundConfirm');
    setConfirm({
      title: t('competitionDetail.deleteRoundTitle'),
      message: confirmMsg,
      confirmLabel: t('competitionDetail.deleteRoundBtn'),
      cancelLabel: t('common.cancel'),
      danger: true,
      action: async () => {
        const res = await api.deleteStageRound(id, stage.id, round.id);
        if (res.code === 200) {
          loadStages();
          msg(t('competitionDetail.roundDeleted'));
        } else if (res.code === 40030) {
          msg(t('competitionDetail.roundStartedNoDelete'), 'error');
        } else {
          msg(t('competitionDetail.roundDeleteFailed', { msg: res.message || res.code }), 'error');
        }
      },
    });
  };

  // Enter edit mode: copy the round's current values into editForm so the
  // form is pre-populated, and mark this round as the one being edited.
  const startEditRound = (round) => {
    setEditForm({
      name: round.name || '',
      durationSeconds: round.duration_seconds || 600,
      preparationSeconds: round.preparation_seconds ?? 10,
    });
    setEditingRoundId(round.id);
  };

  // Save the edited round. Only name, duration, and preparation are sent —
  // the server refuses to change roundType (would break the engine). On
  // success, exit edit mode and reload so the new values show everywhere.
  const handleSaveRound = async (stage, round) => {
    const res = await api.updateStageRound(id, stage.id, round.id, {
      name: editForm.name,
      durationSeconds: editForm.durationSeconds,
      preparationSeconds: editForm.preparationSeconds,
    });
    if (res.code === 200) {
      setEditingRoundId(null);
      loadStages();
      msg(t('competitionDetail.roundUpdated'));
    } else if (res.code === 40030) {
      msg(t('competitionDetail.roundStartedNoDelete'), 'error');
    } else {
      msg(t('competitionDetail.roundUpdateFailed', { msg: res.message || res.code }), 'error');
    }
  };

  // Stages can only be changed while the competition is being prepared. The
  // server enforces the same rule (GameOrchestrator.configureStages refuses
  // RUNNING and FINISHED); this only decides whether the controls are shown.
  const isEditable = competition?.status === 'DRAFT' || competition?.status === 'PUBLISHED';
  const isRunning = competition?.status === 'RUNNING';
  const isPaused = competition?.status === 'PAUSED';

  // Competition lifecycle controls for ORG_ADMIN (mirrors judge console actions).
  // Pause: RUNNING → PAUSED. Resume: PAUSED → RUNNING. End: → FINISHED.
  // End uses the ConfirmDialog because it is irreversible.
  const handlePause = async () => {
    const res = await api.pauseCompetition(id);
    if (res.code === 200) { msg(t('competitionDetail.controlSuccess')); load(); bumpPublishRefresh(); }
    else msg(t('competitionDetail.controlFailed', { msg: res.message }), 'error');
  };
  const handleResume = async () => {
    const res = await api.resumeCompetition(id);
    if (res.code === 200) { msg(t('competitionDetail.controlSuccess')); load(); bumpPublishRefresh(); }
    else msg(t('competitionDetail.controlFailed', { msg: res.message }), 'error');
  };
  const handleEndCompetition = () => {
    setConfirm({
      title: t('competitionDetail.endConfirmTitle'),
      message: t('competitionDetail.endConfirmBody'),
      confirmLabel: t('competitionDetail.endCompetition'),
      cancelLabel: t('common.cancel'),
      danger: true,
      action: async () => {
        const res = await api.endCompetition(id);
        if (res.code === 200) { msg(t('competitionDetail.controlSuccess')); load(); bumpPublishRefresh(); }
        else msg(t('competitionDetail.controlFailed', { msg: res.message }), 'error');
      },
    });
  };

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
      // BUG-02 fix: a new stage changes publishability (a new empty stage
      // flips "every stage configured" to red). Bump so PublishPanel
      // refetches its snapshot.
      bumpPublishRefresh();
    } else {
      msg(t('competitionDetail.stageAddFailed', { msg: res.message || res.code }), 'error');
    }
  };

  const handleRemoveStage = async (stageId) => {
    // The server refuses an empty list ("at least one stage"), which would
    // surface as a puzzling error. Say it plainly instead.
    if (stages.length <= 1) return msg(t('competitionDetail.lastStageKept'), 'error');
    setConfirm({
      title: t('competitionDetail.removeStageTitle'),
      message: t('competitionDetail.confirmRemoveStage'),
      confirmLabel: t('competitionDetail.removeStage'),
      cancelLabel: t('common.cancel'),
      danger: true,
      action: async () => {
        const res = await submitStages(stages.filter(s => s.id !== stageId));
        if (res.code === 200) {
          setStages(res.data || []);
          msg(t('competitionDetail.stageRemoved'));
          bumpPublishRefresh();
        } else {
          msg(t('competitionDetail.stageRemoveFailed', { msg: res.message || res.code }), 'error');
        }
      },
    });
  };

  const handleAssignJudge = async () => {
    // BUG-01 fix: use the admin's selection instead of always grabbing the
    // first JUDGE in the list. If none is picked (empty prompt), tell the
    // admin instead of silently assigning someone.
    if (!selectedJudgeId) return msg(t('competitionDetail.judgeNotSelected'), 'error');
    const res = await api.assignJudge(id, selectedJudgeId);
    if (res.code === 200) {
      msg(t('competitionDetail.judgeAssigned'));
      setSelectedJudgeId('');
      // BUG-02 fix: judge list changed → publishability "Has judges" check
      // must flip. load() refetches competition (which holds judges), and
      // bumpPublishRefresh makes PublishPanel refetch its snapshot.
      await load();
      bumpPublishRefresh();
    } else {
      msg(res.message || t('competitionDetail.assignJudgeFailed'), 'error');
    }
  };

  const handleCreateAndAssignJudge = async () => {
    if (!newJudgeName.trim()) return msg(t('competitionDetail.judgeNameRequired'), 'error');
    setCreatingJudge(true);
    try {
      const res = await api.createAndAssignJudge(id, newJudgeName.trim());
      if (res.code === 200) {
        setCreatedCredentials(res.data);
        setShowCredentialsDialog(true);
        setNewJudgeName('');
        await load();
        bumpPublishRefresh();
      } else {
        msg(t('competitionDetail.createJudgeFailed', { msg: res.message || res.code }), 'error');
      }
    } catch (err) {
      msg(t('competitionDetail.createJudgeFailed', { msg: err.message }), 'error');
    } finally {
      setCreatingJudge(false);
    }
  };

  // BUG-01 fix: unassigned judges = users with role JUDGE who are not already
  // in competition.judges. The server sends judges with either id or userId
  // (depends on the join), so we check both. Use optional chaining because
  // competition is null on first render (before the null guard).
  const unassignedJudges = users.filter(u => u.role === 'JUDGE' &&
    !(competition?.judges || []).some(j => j.id === u.id || j.userId === u.id));

  const handleDeleteParticipants = async () => {
    setConfirm({
      title: t('competitionDetail.deleteParticipantsTitle'),
      message: t('competitionDetail.confirmDeleteParticipants'),
      confirmLabel: t('competitionDetail.deleteBtn'),
      cancelLabel: t('common.cancel'),
      danger: true,
      action: async () => {
        const res = await api.deleteParticipants(id);
        if (res.code === 200) {
          msg(t('competitionDetail.deleteSuccess') + ': ' + t('competitionDetail.deletedCount') + ' ' + (res.data?.deleted || 0));
          loadParticipants();
        } else {
          msg(res.message || 'Delete failed', 'error');
        }
      },
    });
  };

  // Export credentials from the in-memory snapshot captured during the last
  // /confirm call. If the admin navigated away or refreshed, the snapshot is
  // null — surface a clear message instead of failing silently. The server
  // cannot regenerate plain-text passwords (they are hashed), so the only
  // recovery is to re-import and capture a fresh snapshot.
  const handleExportCredentials = async () => {
    if (!credentials?.length) {
      msg(t('competitionDetail.noCredentialsToExport'), 'error');
      return;
    }
    setExporting(true);
    const res = await api.exportParticipants(id, credentials);
    setExporting(false);
    if (res.success) {
      msg(t('competitionDetail.exportSuccess'), 'success');
    } else {
      msg(res.message || t('competitionDetail.exportFailed'), 'error');
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
            refreshKey={publishRefreshKey}
            onStatusChange={load}
          />
        )}

        {/* Competition lifecycle controls — visible when the competition is
            actively running (RUNNING or PAUSED). The ORG_ADMIN can pause,
            resume, or end the competition. End uses a confirmation dialog
            because it is irreversible. Cancel (→ DRAFT) stays in PublishPanel. */}
        {isAdmin && (isRunning || isPaused) && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              {t('competitionDetail.competitionControl')}
            </h3>
            <div className="flex flex-wrap gap-3">
              {isRunning && (
                <button
                  onClick={handlePause}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
                >
                  {t('competitionDetail.pauseCompetition')}
                </button>
              )}
              {isPaused && (
                <button
                  onClick={handleResume}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  {t('competitionDetail.resumeCompetition')}
                </button>
              )}
              <button
                onClick={handleEndCompetition}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              >
                {t('competitionDetail.endCompetition')}
              </button>
            </div>
          </div>
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
                  aria-label={t(st.labelKey)}
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
                          {isOpen ? t('competitionDetail.closeStage') : t('competitionDetail.addRound')}
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
                        {stage.rounds?.length > 0 && (
                          <h4 className="text-xs sm:text-sm font-medium text-gray-600">
                            {t('competitionDetail.stageRoundsTitle')}
                          </h4>
                        )}

                        {stage.rounds?.length ? (
                          <ol className="space-y-2">
                            {stage.rounds.map(r => (
                              <li key={r.id} className="bg-gray-50 rounded p-2">
                                {/* CRUD-Rounds (2026-08-26): two render modes
                                    for the same round. Read mode shows the
                                    name, a configured/not-configured badge,
                                    the meta line, and (for an admin on an
                                    editable competition) Edit/Delete
                                    buttons. Edit mode replaces the whole
                                    row with an inline form bound to
                                    editForm; saving calls handleSaveRound,
                                    cancel reverts to read mode. The PDF
                                    import lives ONLY in edit mode — Louise
                                    UX decision 2026-08-26: the read-only
                                    line must stay clean, configuration
                                    actions happen in the edit form. */}
                                {editingRoundId === r.id ? (
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                      <input
                                        type="text"
                                        value={editForm.name}
                                        onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder={t('competitionDetail.roundName')}
                                        className="px-2 py-1 border rounded text-xs sm:text-sm"
                                        aria-label={t('competitionDetail.roundName')}
                                      />
                                      <input
                                        type="number"
                                        min="1"
                                        value={editForm.durationSeconds}
                                        onChange={(e) => setEditForm(f => ({ ...f, durationSeconds: parseInt(e.target.value) || 600 }))}
                                        placeholder={t('competitionDetail.roundDuration')}
                                        className="px-2 py-1 border rounded text-xs sm:text-sm"
                                        aria-label={t('competitionDetail.roundDuration')}
                                      />
                                      <input
                                        type="number"
                                        min="0"
                                        max="300"
                                        value={editForm.preparationSeconds}
                                        onChange={(e) => setEditForm(f => ({ ...f, preparationSeconds: parseInt(e.target.value) || 0 }))}
                                        placeholder={t('competitionDetail.roundPreparation')}
                                        className="px-2 py-1 border rounded text-xs sm:text-sm"
                                        aria-label={t('competitionDetail.roundPreparation')}
                                      />
                                    </div>
                                    {/* PDF import lives in the edit form, not
                                        on the read-only line. Only shown when
                                        the round is still empty — the server
                                        refuses to overwrite a round that
                                        already has puzzles (40030). */}
                                    {isAdmin && isEditable && (r.puzzles?.length || 0) === 0 && (
                                      <div className="flex flex-wrap gap-2">
                                        <RoundPdfImport
                                          round={r}
                                          onImported={loadStages}
                                          onSuccess={(summary) => msg(summary)}
                                        />
                                        <RoundBankImport
                                          round={r}
                                          onImported={loadStages}
                                          onSuccess={(summary) => msg(summary)}
                                        />
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleSaveRound(stage, r)}
                                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium"
                                      >
                                        {t('competitionDetail.saveRoundBtn')}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingRoundId(null)}
                                        className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded text-xs font-medium"
                                      >
                                        {t('competitionDetail.cancelEditRoundBtn')}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                    <span className="text-xs sm:text-sm flex items-center gap-2">
                                      <span className="text-gray-500">{t('competitionDetail.roundNumber', { n: r.order_number })}</span>
                                      {' '}<span className="font-medium">{r.name}</span>
                                      {/* Configured badge: green if the round
                                          has at least one puzzle, yellow if
                                          it's still empty. Purely UI, no API
                                          call — reads r.puzzles.length which
                                          is already in the list payload. */}
                                      <span className={`px-1.5 py-0.5 rounded-full text-[0.65rem] font-medium ${
                                        (r.puzzles?.length || 0) > 0
                                          ? 'bg-green-100 text-green-700'
                                          : 'bg-yellow-100 text-yellow-700'
                                      }`}>
                                        {(r.puzzles?.length || 0) > 0
                                          ? t('competitionDetail.roundConfigured')
                                          : t('competitionDetail.roundNotConfigured')}
                                      </span>
                                      {/* DRAFT badge for rounds saved mid-config */}
                                      {r.status === 'DRAFT' && (
                                        <span className="px-1.5 py-0.5 rounded-full text-[0.65rem] font-medium bg-orange-100 text-orange-700">
                                          {t('competitionDetail.roundDraft')}
                                        </span>
                                      )}
                                    </span>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs text-gray-400">
                                        {/* BUG-03: translate the raw roundType enum via common.roundName.* */}
                                        {t('competitionDetail.roundMeta', {
                                          type: t(`common.roundName.${r.type}`) || r.type,
                                          dur: r.duration_seconds,
                                          count: r.puzzles?.length || 0,
                                        })}
                                      </span>
                                      {/* CRUD-Rounds (2026-08-26): Edit and
                                          Delete. Only shown to an admin while
                                          the competition is still editable.
                                          The server re-checks the WAITING
                                          status guard, so even if the button
                                          is shown for a round that started
                                          between the last reload and the
                                          click, the call returns 40030 and
                                          the handler surfaces the message.
                                          PDF import is NOT on this read-only
                                          line — it lives in edit mode. */}
                                      {isAdmin && isEditable && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => startEditRound(r)}
                                            className="px-2 py-1 text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 rounded text-xs"
                                          >
                                            {t('competitionDetail.editRoundBtn')}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteRound(stage, r)}
                                            className="px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded text-xs"
                                          >
                                            {t('competitionDetail.deleteRoundBtn')}
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-gray-400 text-xs sm:text-sm">{t('competitionDetail.noRoundsInStage')}</p>
                        )}

                        {/* "Add Round" button inside the stage — clicking it
                            reveals the creation form below. The form stays
                            hidden until the admin explicitly asks for it,
                            keeping the expanded stage clean. */}
                        {isAdmin && isEditable && openRoundFormStageId !== stage.id && (
                          roundTypesError ? (
                            <p className="text-xs sm:text-sm text-red-600">
                              {t('competitionDetail.roundTypesUnavailable', { msg: roundTypesError })}
                            </p>
                          ) : allowedTypes.length === 0 ? (
                            <p className="text-xs sm:text-sm text-gray-400">{t('competitionDetail.noRoundTypeForStage')}</p>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenAddRoundForm(stage)}
                              className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs sm:text-sm hover:bg-indigo-500"
                            >
                              {t('competitionDetail.addRound')}
                            </button>
                          )
                        )}

                        {isAdmin && isEditable && openRoundFormStageId === stage.id && (
                          <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-indigo-200">
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

                            {/* Preparation time — how long players read the
                                round's rules before the board opens. */}
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">
                                {t('competitionDetail.roundPreparation')}
                              </label>
                              <input type="number" min="0" max="300"
                                aria-label={t('competitionDetail.roundPreparation')}
                                value={roundForm.preparationSeconds}
                                onChange={e => setRoundForm({ ...roundForm, preparationSeconds: parseInt(e.target.value) || 0 })}
                                className="w-full px-3 py-2 border rounded text-xs sm:text-sm" />
                              <p className="text-xs text-gray-400 mt-1">{t('competitionDetail.roundPreparationHint')}</p>
                            </div>

                            {/* Import buttons — visible immediately since draftRound
                                already exists. Admin can import puzzles without
                                waiting for form submission. */}
                            {draftRound && (
                              <div className="flex flex-wrap gap-2 pt-2">
                                <RoundPdfImport
                                  round={draftRound}
                                  onImported={() => loadStages()}
                                  onSuccess={(summary) => msg(summary)}
                                />
                                <RoundBankImport
                                  round={draftRound}
                                  onImported={() => loadStages()}
                                  onSuccess={(summary) => msg(summary)}
                                />
                              </div>
                            )}

                            <div className="flex gap-2 pt-1">
                              <button type="button" onClick={(e) => handleSaveDraftRound(e, stage)} className="px-4 py-2 bg-indigo-600 text-white rounded text-xs sm:text-sm hover:bg-indigo-500">
                                {t('competitionDetail.addRoundSubmit')}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelRoundForm(stage)}
                                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded text-xs sm:text-sm hover:bg-gray-50"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          </div>
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
                {credentials?.length > 0 && (
                  <button
                    onClick={handleExportCredentials}
                    disabled={exporting}
                    className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs sm:text-sm hover:bg-indigo-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {exporting ? t('competitionDetail.exporting') : t('competitionDetail.exportCredentialsBtn')}
                  </button>
                )}
                {participants.length > 0 && (
                  <>
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
                  onImportComplete={(creds) => {
                    setShowParticipantImport(false);
                    // Capture the credentials snapshot at the page level so
                    // the standalone "Export credentials" button on the page
                    // works — not just the one inside the import panel.
                    setCredentials(creds || null);
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
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center w-full sm:w-auto">
                {/* Existing dropdown for pre-created judges */}
                {unassignedJudges.length > 0 && (
                  <select
                    value={selectedJudgeId}
                    onChange={(e) => setSelectedJudgeId(e.target.value)}
                    aria-label={t('competitionDetail.assignJudge')}
                    className="px-2 py-1.5 border rounded text-xs sm:text-sm"
                  >
                    <option value="">{t('competitionDetail.selectJudge')}</option>
                    {unassignedJudges.map(u => (
                      <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={handleAssignJudge}
                  disabled={!selectedJudgeId}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs sm:text-sm hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('competitionDetail.assignJudge')}
                </button>

                {/* New: create judge from name input */}
                <div className="flex gap-2 sm:ml-2">
                  <input
                    type="text"
                    value={newJudgeName}
                    onChange={(e) => setNewJudgeName(e.target.value)}
                    placeholder={t('competitionDetail.newJudgeNamePlaceholder')}
                    className="px-2 py-1.5 border rounded text-xs sm:text-sm flex-1 sm:w-40"
                    disabled={creatingJudge}
                  />
                  <button
                    onClick={handleCreateAndAssignJudge}
                    disabled={creatingJudge || !newJudgeName.trim()}
                    className="px-3 py-1.5 bg-green-600 text-white rounded text-xs sm:text-sm hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {creatingJudge ? '...' : t('competitionDetail.createAndAssignJudge')}
                  </button>
                </div>
              </div>
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

        {/* Credentials dialog — shown once after judge creation */}
        {showCredentialsDialog && createdCredentials && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold mb-4">{t('competitionDetail.judgeCredentialsTitle')}</h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-4">{t('competitionDetail.judgeCredentialsHint')}</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('judges.usernameLabel')}</label>
                  <div className="bg-gray-50 px-3 py-2 rounded text-sm font-mono break-all">{createdCredentials.username}</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('judges.passwordLabel')}</label>
                  <div className="bg-gray-50 px-3 py-2 rounded text-sm font-mono break-all">{createdCredentials.password}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => {
                    const text = `${createdCredentials.username}\n${createdCredentials.password}`;
                    navigator.clipboard.writeText(text);
                    msg(t('judges.copyCredentials'));
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-500"
                >
                  {t('judges.copyCredentials')}
                </button>
                <button
                  onClick={() => {
                    setShowCredentialsDialog(false);
                    setCreatedCredentials(null);
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/* Big-screen display link — same gate as the access link (admin-only,
            post-publish). The admin generates the URL here, copies it, opens
            it on the big-screen device in the room. The judge then controls
            what the screen shows from JudgeControlPage (display mode,
            broadcast). Token generation is a configuration action (ORG_ADMIN);
            mode switching is a floor operation (JUDGE or ORG_ADMIN). */}
        {isAdmin && (
          <DisplayTokenSection competitionId={id} />
        )}

        {/* Louise UX 2026-08-26: styled replacement for window.confirm().
            One instance serves all three confirmations (delete round, delete
            stage, delete participants). The parent swaps the props each time
            setConfirm is called. */}
        <ConfirmDialog
          open={!!confirm}
          title={confirm?.title || ''}
          message={confirm?.message || ''}
          confirmLabel={confirm?.confirmLabel || 'OK'}
          cancelLabel={confirm?.cancelLabel || 'Cancel'}
          danger={confirm?.danger || false}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const action = confirm?.action;
            setConfirm(null);
            if (typeof action === 'function') {
              try {
                await action();
              } catch (err) {
                msg(err.message || 'Error', 'error');
              }
            }
          }}
        />
      </main>
    </div>
  );
}
