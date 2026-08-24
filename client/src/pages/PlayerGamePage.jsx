/**
 * PlayerGamePage — Thin orchestrator for game play.
 *
 * Delegates rendering to Round1View, Round2View, or Round3View.
 * Uses server-authoritative timer via useTimer + TimerDisplay.
 * Handles socket events, REST fallback, and puzzle selection.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import { translateServerMessage } from '../i18n/serverMessages';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { LocalErrorBoundary } from '../components/ErrorBoundary';
import { useGameSocket } from '../hooks/useGameSocket';
import { useTimer } from '../hooks/useTimer';
import { submitCellFill, submitAnswer } from '../api/socket';
import { api } from '../api';
import TimerDisplay from '../components/TimerDisplay';
import Round1View from './Round1View';
import Round2View from './Round2View';
import Round3View from './Round3View';
import WaitingScreen from './WaitingScreen';
import PreparationScreen from './PreparationScreen';
import TransitionScreen from './TransitionScreen';
import StageFinishedScreen from './StageFinishedScreen';
import { chooseScreen } from './chooseScreen';

export default function PlayerGamePage() {
  const { competitionId } = useParams();
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [competition, setCompetition] = useState(null);
  const [currentRound, setCurrentRound] = useState(null);
  const [activePuzzle, setActivePuzzle] = useState(null);
  // Message banner: { text, type } where type ∈ 'success' | 'warning' | 'error' | 'info'
  const [message, setMessage] = useState(null);
  const messageTimerRef = useRef(null);

  // Local state for puzzles (populated by REST + socket)
  const [puzzles, setPuzzles] = useState([]);

  // Team score (updated by socket events and REST fallback)
  const [teamScore, setTeamScore] = useState(0);

  // Socket events (puzzles/timer merged into local state)
  const {
    puzzles: socketPuzzles,
    timerMeta,
    events,
    round1Progress,
    round2State,
    round3State,
    rotationWarning,
    activeTeammates,
    preparation,
    transition,
    stageFinished,
    competitionFinished,
    onLetterReveal,
    updateCell,
    proposeCell,
    acceptProposal,
    rejectProposal,
    withdrawProposal,
    focusUpdate,
    setRound2FromRest,
    setRound3FromRest,
    setTimerMetaFromRest,
  } = useGameSocket(competitionId);

  // Server-authoritative timer
  const { remainingSeconds, formattedTime, isPaused } = useTimer(timerMeta);

  const isRound1 = currentRound?.roundType === 'ROUND1_NINE_ONE';
  const isRound2 = currentRound?.roundType === 'ROUND2_RELAY';
  const isRound3 = currentRound?.roundType === 'ROUND3_COLLABORATE';

  const showMessage = useCallback((text, type = 'info') => {
    setMessage({ text, type });
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), 3000);
  }, []);

  // Load competition info
  useEffect(() => {
    api.getCompetition(competitionId).then(res => {
      if (res.code === 200) setCompetition(res.data);
    });
  }, [competitionId]);

  // REST fallback: fetch current game state on mount (handles late-join / page refresh)
  useEffect(() => {
    if (user?.role !== 'PLAYER') return;
    api.getMyGameState(competitionId).then(res => {
      // `competitionId` is the UUID from useParams(), passed through unchanged
      // to both REST and WebSocket calls. The socket emissions used to wrap it
      // in parseInt() — a leftover of the SERIAL era. parseInt on a UUID yields
      // a small integer rather than NaN, so the socket schema rejected every
      // message: the player could never join a room or submit an answer.
      if (res.code === 200 && res.data?.currentRound) {
        setCurrentRound(res.data.currentRound);

        // Feed timer state from REST
        if (res.data.currentRound.turnEndsAt != null || res.data.currentRound.timerStatus) {
          setTimerMetaFromRest({
            turnEndsAt: res.data.currentRound.turnEndsAt,
            timerStatus: res.data.currentRound.timerStatus || 'UNKNOWN',
            durationSeconds: res.data.currentRound.durationSeconds,
          });
        }

        if (res.data.puzzles?.length > 0) {
          setPuzzles(res.data.puzzles);
        }

        // Round 1 REST fallback progress
        if (res.data.round1Progress) {
          setTeamScore(res.data.round1Progress.teamScore || 0);
        }

        // Round 2 REST fallback
        if (res.data.round2State) {
          setRound2FromRest(res.data.round2State);
          setTeamScore(res.data.round2State.teamScore || 0);
          if (res.data.round2State.assignedPuzzle) {
            setActivePuzzle(res.data.round2State.assignedPuzzle);
          }
        }

        // Round 3 REST fallback
        if (res.data.round3State) {
          setRound3FromRest(res.data.round3State);
          setTeamScore(res.data.round3State.teamScore || 0);
          // Find the current puzzle from round3State
          if (res.data.round3State.currentPuzzleId) {
            const currentPuzzle = res.data.round3State.puzzles?.find(
              p => p.puzzleId === res.data.round3State.currentPuzzleId
            );
            if (currentPuzzle) {
              setActivePuzzle(currentPuzzle);
            }
          }
        }
      }
    });
  }, [competitionId, user?.role, setRound2FromRest, setRound3FromRest, setTimerMetaFromRest]);

  // Merge socket puzzles into local state
  useEffect(() => {
    if (socketPuzzles.length > 0) setPuzzles(socketPuzzles);
  }, [socketPuzzles]);

  // Update team score from round1Progress
  useEffect(() => {
    if (round1Progress && isRound1) {
      const solvedCount = Object.keys(round1Progress.solvedPuzzles).length;
      if (solvedCount > 0) {
        const pts = puzzles.length > 0 ? Math.round(200 / puzzles.length) : 20;
        setTeamScore(solvedCount * pts);
      }
    }
  }, [round1Progress, isRound1, puzzles.length]);

  // Update team score from round3State
  useEffect(() => {
    if (round3State && isRound3) {
      setTeamScore(round3State.teamScore || 0);
    }
  }, [round3State, isRound3]);

  // Set first unlocked, non-completed puzzle as active when puzzles arrive (Round 1 & 3)
  useEffect(() => {
    if (!isRound2 && puzzles.length > 0 && !activePuzzle) {
      const firstAvailable = puzzles.find(p => !p.isLocked && !p.isCompleted) || puzzles.find(p => !p.isLocked) || puzzles[0];
      setActivePuzzle(firstAvailable);
    }
  }, [puzzles, isRound2, activePuzzle]);

  // For Round 3, update active puzzle from round3State.currentPuzzleId
  useEffect(() => {
    if (isRound3 && round3State?.currentPuzzleId && round3State.puzzles?.length > 0) {
      const currentPuzzle = round3State.puzzles.find(p => p.puzzleId === round3State.currentPuzzleId);
      if (currentPuzzle) {
        setActivePuzzle(currentPuzzle);
      }
    }
  }, [isRound3, round3State?.currentPuzzleId, round3State?.puzzles]);

  // Letter reveal callback
  useEffect(() => {
    onLetterReveal(() => {});
  }, [onLetterReveal]);

  // Handle socket events
  useEffect(() => {
    const latest = events[events.length - 1];
    if (!latest) return;

    switch (latest.type) {
      case 'ROUND_STARTED':
        setCurrentRound(latest.payload);
        setActivePuzzle(null);
        setTeamScore(0);
        showMessage(t('game.roundStarted', { n: latest.payload.roundNumber, name: latest.payload.roundName }), 'info');
        break;
      case 'ROUND_FINISHED':
        showMessage(t('game.roundFinished'), 'info');
        setCurrentRound(null);
        break;
      // STAGE_FINISHED and COMPETITION_FINISHED are the two terminal events
      // useGameSocket listens to (it sets stageFinished / competitionFinished).
      // PlayerGamePage owns `currentRound` (local useState, not in the hook),
      // so it must clear it here too — otherwise chooseScreen would route to
      // ROUND_LOADING (active round, no data) instead of the terminal screen,
      // because ROUND_FINISHED may not have arrived last (server ordering:
      // ROUND_FINISHED → STAGE_FINISHED → COMPETITION_FINISHED).
      case 'STAGE_FINISHED':
        setCurrentRound(null);
        break;
      case 'COMPETITION_FINISHED':
        setCurrentRound(null);
        break;
      case 'ANSWER_RESULT':
        if (latest.payload.alreadySolved) {
          showMessage(t('game.alreadySolvedByTeam'), 'warning');
        } else if (latest.payload.isCorrect) {
          showMessage(t('game.correct', { pts: latest.payload.pointsEarned }), 'success');
        } else {
          showMessage(translateServerMessage(latest.payload.message, lang) || t('game.wrongAnswer'), 'error');
        }
        break;
      case 'CELL_FILL_ACK':
        showMessage(t('game.filled'), 'warning');
        break;
      case 'CELL_CONFLICT':
        showMessage(t('game.cellConflict', { msg: translateServerMessage(latest.payload.message, lang) }), 'error');
        break;
      case 'ROUND1_PUZZLE_SOLVED': {
        const { totalRound1Score } = latest.payload;
        if (totalRound1Score !== undefined) setTeamScore(totalRound1Score);
        break;
      }
      case 'SCORE_UPDATE':
        if (latest.payload.teamTotalPoints !== undefined) setTeamScore(latest.payload.teamTotalPoints);
        break;
      case 'ROUND2_PUZZLE_SOLVED': {
        const { teamScore: r2Score, completionBonus } = latest.payload;
        if (r2Score !== undefined) setTeamScore(r2Score);
        if (completionBonus > 0) {
          showMessage(t('game.allSolvedBonus', { bonus: completionBonus }), 'success');
        }
        break;
      }
      case 'ROUND2_PUZZLE_ASSIGNED':
        setActivePuzzle({
          puzzleId: latest.payload.puzzleId,
          puzzleType: latest.payload.puzzleType,
          orderInRound: latest.payload.orderInRound,
          initialGrid: latest.payload.initialGrid,
          currentGrid: latest.payload.currentGrid || latest.payload.initialGrid,
          points: latest.payload.points,
          difficulty: latest.payload.difficulty || 'MEDIUM'
        });
        break;
      case 'ROUND2_STARTED':
        if (latest.payload.assignedPuzzle) {
          setActivePuzzle(latest.payload.assignedPuzzle);
        }
        if (latest.payload.teamScore !== undefined) setTeamScore(latest.payload.teamScore);
        break;
      case 'ROUND3_BOARD_UPDATED':
        // Score update for R3
        if (latest.payload.teamScore !== undefined) setTeamScore(latest.payload.teamScore);
        break;
      case 'TEAM_PUZZLE_NEXT':
        // R3 moved to next puzzle — activePuzzle will be updated by round3State effect
        break;
      default:
        break;
    }
  }, [events, showMessage, t, lang]);

  // Mark puzzle as completed locally when round1Progress shows it solved
  useEffect(() => {
    if (!round1Progress || !isRound1) return;
    setPuzzles(prev => prev.map(p => {
      if (round1Progress.solvedPuzzles[p.puzzleId]) {
        return { ...p, isCompleted: true };
      }
      return p;
    }));
    // Unlock final puzzle when all JOC solved
    if (round1Progress.finalUnlocked) {
      setPuzzles(prev => prev.map(p => {
        if (p.isFinal) return { ...p, isLocked: false };
        return p;
      }));
    }
  }, [round1Progress, isRound1]);

  const handleCellSubmit = useCallback((row, col, value) => {
    if (!activePuzzle || !currentRound) return;
    if (activePuzzle.isLocked) {
      showMessage(t('game.puzzleLocked'), 'warning');
      return;
    }
    if (activePuzzle.isCompleted) {
      showMessage(t('game.puzzleCompleted'), 'warning');
      return;
    }
    if (currentRound.roundType === 'ROUND3_COLLABORATE') {
      submitCellFill(competitionId, currentRound.roundId, activePuzzle.puzzleId, row, col, value);
    } else if (currentRound.roundType === 'ROUND1_NINE_ONE') {
      submitAnswer(competitionId, currentRound.roundId, activePuzzle.puzzleId, 'SINGLE_CELL', { row, col, value });
    }
  }, [activePuzzle, currentRound, competitionId, showMessage, t]);

  const handleFullGridSubmit = useCallback((grid) => {
    if (!activePuzzle || !currentRound) return;
    if (activePuzzle.isCompleted) {
      showMessage(t('game.puzzleCompleted'), 'warning');
      return;
    }
    submitAnswer(competitionId, currentRound.roundId, activePuzzle.puzzleId, 'FULL_GRID', { grid });
  }, [activePuzzle, currentRound, competitionId, showMessage, t]);

  // Round 2: cell change handler (sends real-time updates for own puzzle)
  const handleR2CellChange = useCallback((row, col, value) => {
    if (!activePuzzle || !currentRound) return;
    updateCell(currentRound.roundId, activePuzzle.puzzleId, row, col, value);
  }, [activePuzzle, currentRound, updateCell]);

  // Round 3: collaboration handlers
  const handleR3ProposeCell = useCallback((row, col, value) => {
    if (!activePuzzle || !currentRound) return;
    proposeCell(competitionId, currentRound.roundId, activePuzzle.puzzleId, row, col, value);
  }, [activePuzzle, currentRound, competitionId, proposeCell]);

  const handleR3AcceptProposal = useCallback((row, col) => {
    if (!activePuzzle || !currentRound) return;
    acceptProposal(competitionId, currentRound.roundId, activePuzzle.puzzleId, row, col);
  }, [activePuzzle, currentRound, competitionId, acceptProposal]);

  const handleR3RejectProposal = useCallback((row, col) => {
    if (!activePuzzle || !currentRound) return;
    rejectProposal(competitionId, currentRound.roundId, activePuzzle.puzzleId, row, col);
  }, [activePuzzle, currentRound, competitionId, rejectProposal]);

  const handleR3FocusUpdate = useCallback((row, col) => {
    if (!activePuzzle || !currentRound) return;
    focusUpdate(competitionId, currentRound.roundId, activePuzzle.puzzleId, row, col);
  }, [activePuzzle, currentRound, competitionId, focusUpdate]);

  const handleR3WithdrawProposal = useCallback((row, col) => {
    if (!activePuzzle || !currentRound) return;
    withdrawProposal(competitionId, currentRound.roundId, activePuzzle.puzzleId, row, col);
  }, [activePuzzle, currentRound, competitionId, withdrawProposal]);

  // Puzzle selection handler (Round 1 & 3)
  const handleSelectPuzzle = useCallback((puzzle) => {
    if (!puzzle.isLocked) setActivePuzzle(puzzle);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Top bar */}
      <div className="bg-gray-800 px-3 sm:px-6 py-2 sm:py-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <button onClick={() => navigate(`/competitions/${competitionId}`)} className="text-gray-400 hover:text-white text-xs sm:text-sm">
              &larr; {t('game.back')}
            </button>
            <h1 className="text-sm sm:text-lg font-bold">{competition?.name || t('game.defaultCompetitionName')}</h1>
            {currentRound && (
              <span className="text-xs sm:text-sm text-gray-400">
                {currentRound.roundName || `Round ${currentRound.roundNumber}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 sm:gap-6 w-full sm:w-auto">
            {/* The header timer belongs to the round itself — the preparation
                and transition countdowns live inside their own screens. Hiding
                it here is not redundant with routing those ticks away from
                timerMeta: from the SECOND round on, timerMeta keeps the
                previous round's FINISHED state, so without this guard the
                header would show a frozen 0:00 next to no round name for the
                whole between-rounds gap. */}
            {timerMeta.timerStatus !== 'UNKNOWN' && !preparation && !transition && (
              <div className="w-32 sm:w-48">
                <TimerDisplay
                  remainingSeconds={remainingSeconds}
                  totalSeconds={timerMeta.durationSeconds}
                  formattedTime={formattedTime}
                  isPaused={isPaused}
                />
              </div>
            )}
            <span className="text-xs sm:text-sm text-gray-400 hidden sm:inline">{user?.displayName}</span>
            <LanguageSwitcher />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-3 sm:p-6">
        {message && (
          <div className={`mb-4 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm text-center ${
            message.type === 'success' ? 'bg-green-900/50 text-green-300' :
            message.type === 'warning' ? 'bg-yellow-900/50 text-yellow-300' :
            message.type === 'error' ? 'bg-red-900/50 text-red-300' :
            'bg-blue-900/50 text-blue-300'
          }`}>{message.text}</div>
        )}

        {/*
         * Which screen wins — the full priority rule (order AND reason for
         * each position) lives in `chooseScreen.js`, next to the function
         * that enforces it. Read it there. The short version:
         *
         *   transition > preparation > round views (with data) >
         *   round loading (active round, data missing) > waiting
         *
         * The "round loading" state is the bug fix: an active round whose
         * puzzles/state haven't arrived used to fall through to
         * WaitingScreen, which told the player the competition hadn't
         * started — in the middle of a live round.
         *
         * LOCAL BOUNDARY: the round views (Round1/2/3View) render grids and
         * timers and teammate cursors — complex enough to crash on a bad
         * payload. If one crashes mid-round, the player keeps their header
         * (timer, competition name, back button) and sees a targeted
         * message instead of losing the whole screen. This is the case
         * Louise called out: "si la grille du joueur casse, il doit garder
         * son chronomètre, son en-tête et un message lui disant quoi faire".
         */}
        <LocalErrorBoundary>
          {(() => {
            const screen = chooseScreen({
              transition, preparation, currentRound,
              puzzles, round2State, round3State,
              stageFinished, competitionFinished,
            });
            switch (screen) {
              case 'TRANSITION':
                return <TransitionScreen transition={transition} />;
              case 'PREPARATION':
                return <PreparationScreen preparation={preparation} />;
              case 'ROUND2_VIEW':
                return (
                  <Round2View
                    round2State={round2State}
                    activePuzzle={activePuzzle}
                    user={user}
                    onCellChange={handleR2CellChange}
                    onFullGridSubmit={handleFullGridSubmit}
                    rotationWarning={rotationWarning}
                  />
                );
              case 'ROUND1_VIEW':
                return (
                  <Round1View
                    puzzles={puzzles}
                    activePuzzle={activePuzzle}
                    round1Progress={round1Progress}
                    teamScore={teamScore}
                    timerRemaining={remainingSeconds}
                    onSelectPuzzle={handleSelectPuzzle}
                    onCellSubmit={handleCellSubmit}
                    onFullGridSubmit={handleFullGridSubmit}
                  />
                );
              case 'ROUND3_VIEW':
                return (
                  <Round3View
                    round3State={round3State}
                    activePuzzle={activePuzzle}
                    currentRound={currentRound}
                    user={user}
                    activeTeammates={activeTeammates}
                    onSelectPuzzle={handleSelectPuzzle}
                    onProposeCell={handleR3ProposeCell}
                    onAcceptProposal={handleR3AcceptProposal}
                    onRejectProposal={handleR3RejectProposal}
                    onWithdrawProposal={handleR3WithdrawProposal}
                    onFullGridSubmit={handleFullGridSubmit}
                    onFocusUpdate={handleR3FocusUpdate}
                  />
                );
              case 'ROUND_LOADING':
                return (
                  <div className="text-center py-20 text-gray-400 text-sm sm:text-base">
                    {t('roundLoading.message')}
                  </div>
                );
              case 'COMPETITION_FINISHED':
                return <StageFinishedScreen variant="competition" />;
              case 'STAGE_FINISHED':
                return (
                  <StageFinishedScreen
                    variant="stage"
                    stageOrder={stageFinished?.stageOrder ?? null}
                    stageType={stageFinished?.stageType ?? null}
                  />
                );
              case 'WAITING':
              default:
                return <WaitingScreen competitionId={competitionId} />;
            }
          })()}
        </LocalErrorBoundary>
      </div>
    </div>
  );
}
