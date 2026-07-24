/**
 * PlayerGamePage — Thin orchestrator for game play.
 *
 * Delegates rendering to Round1View, Round2View, or Round3View.
 * Uses server-authoritative timer via useTimer + TimerDisplay.
 * Handles socket events, REST fallback, and puzzle selection.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useGameSocket } from '../hooks/useGameSocket';
import { useTimer } from '../hooks/useTimer';
import { api } from '../api';
import TimerDisplay from '../components/TimerDisplay';
import Round1View from './Round1View';
import Round2View from './Round2View';
import Round3View from './Round3View';

export default function PlayerGamePage() {
  const { tournamentId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [currentRound, setCurrentRound] = useState(null);
  const [activePuzzle, setActivePuzzle] = useState(null);
  const [message, setMessage] = useState('');
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
  } = useGameSocket(parseInt(tournamentId));

  // Server-authoritative timer
  const { remainingSeconds, formattedTime, isPaused } = useTimer(timerMeta);

  const isRound1 = currentRound?.roundType === 'ROUND1_NINE_ONE';
  const isRound2 = currentRound?.roundType === 'ROUND2_RELAY';
  const isRound3 = currentRound?.roundType === 'ROUND3_COLLABORATE';

  const showMessage = useCallback((text) => {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(''), 3000);
  }, []);

  // Load tournament info
  useEffect(() => {
    api.getTournament(tournamentId).then(res => {
      if (res.code === 200) setTournament(res.data);
    });
  }, [tournamentId]);

  // REST fallback: fetch current game state on mount (handles late-join / page refresh)
  useEffect(() => {
    if (user?.role !== 'PLAYER') return;
    api.getMyGameState(tournamentId).then(res => {
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
  }, [tournamentId, user?.role, setRound2FromRest, setRound3FromRest, setTimerMetaFromRest]);

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
        showMessage(`第 ${latest.payload.roundNumber} 轮：${latest.payload.roundName} 已开始！`);
        break;
      case 'ROUND_FINISHED':
        showMessage('轮次结束！');
        setCurrentRound(null);
        break;
      case 'ANSWER_RESULT':
        if (latest.payload.alreadySolved) {
          showMessage('这道题已被你的队伍解答！');
        } else if (latest.payload.isCorrect) {
          showMessage(`正确！+${latest.payload.pointsEarned} 分`);
        } else {
          showMessage(latest.payload.message || '答案错误，请重试');
        }
        break;
      case 'CELL_FILL_ACK':
        showMessage('已填入');
        break;
      case 'CELL_CONFLICT':
        showMessage(`格子冲突：${latest.payload.message}`);
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
          showMessage(`全部解答完成！完成奖励：+${completionBonus} 分`);
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
  }, [events, showMessage]);

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
      showMessage('这道题已锁定！');
      return;
    }
    if (activePuzzle.isCompleted) {
      showMessage('这道题已经完成了！');
      return;
    }
    if (currentRound.roundType === 'ROUND3_COLLABORATE') {
      const { submitCellFill } = require('../api/socket');
      submitCellFill(parseInt(tournamentId), currentRound.roundId, activePuzzle.puzzleId, row, col, value);
    } else if (currentRound.roundType === 'ROUND1_NINE_ONE') {
      const { submitAnswer } = require('../api/socket');
      submitAnswer(parseInt(tournamentId), currentRound.roundId, activePuzzle.puzzleId, 'SINGLE_CELL', { row, col, value });
    }
  }, [activePuzzle, currentRound, tournamentId, showMessage]);

  const handleFullGridSubmit = useCallback((grid) => {
    if (!activePuzzle || !currentRound) return;
    if (activePuzzle.isCompleted) {
      showMessage('这道题已经完成了！');
      return;
    }
    const { submitAnswer } = require('../api/socket');
    submitAnswer(parseInt(tournamentId), currentRound.roundId, activePuzzle.puzzleId, 'FULL_GRID', { grid });
  }, [activePuzzle, currentRound, tournamentId, showMessage]);

  // Round 2: cell change handler (sends real-time updates for own puzzle)
  const handleR2CellChange = useCallback((row, col, value) => {
    if (!activePuzzle || !currentRound) return;
    updateCell(currentRound.roundId, activePuzzle.puzzleId, row, col, value);
  }, [activePuzzle, currentRound, updateCell]);

  // Round 3: collaboration handlers
  const handleR3ProposeCell = useCallback((row, col, value) => {
    if (!activePuzzle || !currentRound) return;
    proposeCell(parseInt(tournamentId), currentRound.roundId, activePuzzle.puzzleId, row, col, value);
  }, [activePuzzle, currentRound, tournamentId, proposeCell]);

  const handleR3AcceptProposal = useCallback((row, col) => {
    if (!activePuzzle || !currentRound) return;
    acceptProposal(parseInt(tournamentId), currentRound.roundId, activePuzzle.puzzleId, row, col);
  }, [activePuzzle, currentRound, tournamentId, acceptProposal]);

  const handleR3RejectProposal = useCallback((row, col) => {
    if (!activePuzzle || !currentRound) return;
    rejectProposal(parseInt(tournamentId), currentRound.roundId, activePuzzle.puzzleId, row, col);
  }, [activePuzzle, currentRound, tournamentId, rejectProposal]);

  const handleR3FocusUpdate = useCallback((row, col) => {
    if (!activePuzzle || !currentRound) return;
    focusUpdate(parseInt(tournamentId), currentRound.roundId, activePuzzle.puzzleId, row, col);
  }, [activePuzzle, currentRound, tournamentId, focusUpdate]);

  const handleR3WithdrawProposal = useCallback((row, col) => {
    if (!activePuzzle || !currentRound) return;
    withdrawProposal(parseInt(tournamentId), currentRound.roundId, activePuzzle.puzzleId, row, col);
  }, [activePuzzle, currentRound, tournamentId, withdrawProposal]);

  // Puzzle selection handler (Round 1 & 3)
  const handleSelectPuzzle = useCallback((puzzle) => {
    if (!puzzle.isLocked) setActivePuzzle(puzzle);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Top bar */}
      <div className="bg-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/tournament/${tournamentId}`)} className="text-gray-400 hover:text-white text-sm">
            &larr; 返回
          </button>
          <h1 className="text-lg font-bold">{tournament?.name || '比赛'}</h1>
          {currentRound && (
            <span className="text-sm text-gray-400">
              {currentRound.roundName || `Round ${currentRound.roundNumber}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          {timerMeta.timerStatus !== 'UNKNOWN' && (
            <div className="w-48">
              <TimerDisplay
                remainingSeconds={remainingSeconds}
                totalSeconds={timerMeta.durationSeconds}
                formattedTime={formattedTime}
                isPaused={isPaused}
              />
            </div>
          )}
          <span className="text-sm text-gray-400">{user?.displayName}</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {message && (
          <div className={`mb-4 px-4 py-2 rounded-lg text-center ${
            message.includes('正确') || message.includes('奖励') ? 'bg-green-900/50 text-green-300' :
            message.includes('已') ? 'bg-yellow-900/50 text-yellow-300' :
            message.includes('错误') || message.includes('冲突') || message.includes('未分配') ? 'bg-red-900/50 text-red-300' :
            'bg-blue-900/50 text-blue-300'
          }`}>{message}</div>
        )}

        {isRound2 && currentRound ? (
          <Round2View
            round2State={round2State}
            activePuzzle={activePuzzle}
            user={user}
            onCellChange={handleR2CellChange}
            onFullGridSubmit={handleFullGridSubmit}
            rotationWarning={rotationWarning}
          />
        ) : isRound1 && puzzles.length > 0 && currentRound ? (
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
        ) : isRound3 && currentRound ? (
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
        ) : (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">等待轮次开始...</p>
            <p className="text-gray-500 text-sm mt-2">裁判准备好后将开始轮次</p>
          </div>
        )}
      </div>
    </div>
  );
}
