import { useState, useEffect, useRef, useCallback } from 'react';
import { connectSocket, disconnectSocket, joinRoom, leaveRoom, onEvent, round2CellUpdate as socketCellUpdate, round3ProposeCell as socketPropose, round3AcceptProposal as socketAccept, round3RejectProposal as socketReject, round3WithdrawProposal as socketWithdraw, round3FocusUpdate as socketFocus } from '../api/socket';
import { useAuth } from './useAuth';

export function useGameSocket(tournamentId) {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [puzzles, setPuzzles] = useState([]);
  const [timerMeta, setTimerMeta] = useState({
    turnEndsAt: null,
    timerStatus: 'UNKNOWN',
    durationSeconds: 0
  });
  const [scoreUpdates, setScoreUpdates] = useState([]);
  const [round1Progress, setRound1Progress] = useState({ solvedPuzzles: {}, clues: [], finalUnlocked: false, finalPuzzle: null });
  const [round2State, setRound2State] = useState({
    playerOrder: [],
    playerNames: {},
    puzzles: [],
    assignedPuzzleId: null,
    assignedPuzzle: null,
    rotationInterval: 60,
    nextRotationAt: null,
    teamScore: 0,
    solvedCount: 0,
    totalPuzzles: 16,
    allSolved: false,
    completionBonus: 0
  });
  const [round3State, setRound3State] = useState({
    puzzles: [],
    currentPuzzleId: null,
    cells: {},
    suggestions: {},
    suggestionVotes: {},
    playerFocuses: {},
    teamMembers: [],
    teamScore: 0,
    solvedCount: 0,
    totalPuzzles: 10
  });
  const [activeTeammates, setActiveTeammates] = useState({});
  const [rotationWarning, setRotationWarning] = useState(false);
  const warningTimerRef = useRef(null);
  const callbacksRef = useRef({});

  useEffect(() => {
    if (!user) return;
    const socket = connectSocket();
    if (!socket) return;

    setConnected(true);
    if (tournamentId) joinRoom(tournamentId);

    const cleanup = onEvent((event) => {
      setEvents(prev => [...prev.slice(-50), event]);

      switch (event.type) {
        case 'PUZZLE_ASSIGN': {
          const assigned = event.payload.puzzles || [];
          setPuzzles(prev => [...prev, ...assigned]);
          // Round 3 reads its puzzle list from round3State.puzzles. The server
          // only emits PUZZLE_ASSIGN on round start (not ROUND3_STATE_SYNC), so
          // seed round3State here too — otherwise the R3 puzzle list stays empty
          // until a page reload (REST fallback). Only seed when still empty.
          setRound3State(prev => (prev.puzzles && prev.puzzles.length > 0)
            ? prev
            : {
                ...prev,
                puzzles: assigned,
                currentPuzzleId: prev.currentPuzzleId || (assigned[0] && assigned[0].puzzleId) || null,
              });
          break;
        }
        case 'TIMER_TICK':
          setTimerMeta(prev => ({
            turnEndsAt: event.payload.turnEndsAt || prev.turnEndsAt,
            timerStatus: event.payload.timerStatus || 'RUNNING',
            durationSeconds: event.payload.totalSeconds || prev.durationSeconds
          }));
          break;
        case 'SCORE_UPDATE':
          setScoreUpdates(prev => [...prev.slice(-20), event.payload]);
          break;
        case 'PLAYER_STATUS_CHANGE': {
          const { playerId, playerName, online } = event.payload;
          const pid = String(playerId);
          setActiveTeammates(prev => {
            const next = { ...prev };
            if (online) {
              next[pid] = { playerName, online: true };
            } else {
              delete next[pid];
            }
            return next;
          });
          break;
        }
        case 'ROUND_STARTED':
          setPuzzles([]);
          setTimerMeta({
            turnEndsAt: event.payload.turnEndsAt || null,
            timerStatus: 'RUNNING',
            durationSeconds: event.payload.durationSeconds || 0
          });
          setRound1Progress({ solvedPuzzles: {}, clues: [], finalUnlocked: false, finalPuzzle: null });
          setRound2State({
            playerOrder: [], playerNames: {}, puzzles: [],
            assignedPuzzleId: null, assignedPuzzle: null,
            rotationInterval: 60, nextRotationAt: null,
            teamScore: 0, solvedCount: 0, totalPuzzles: 16, allSolved: false, completionBonus: 0
          });
          setRound3State({
            puzzles: [], currentPuzzleId: null,
            cells: {}, suggestions: {}, suggestionVotes: {}, playerFocuses: {},
            teamScore: 0, solvedCount: 0, totalPuzzles: 10
          });
          break;
        case 'ROUND_FINISHED':
          setTimerMeta(prev => ({ ...prev, timerStatus: 'FINISHED' }));
          break;
        case 'TOURNAMENT_PAUSED':
          setTimerMeta(prev => ({
            ...prev,
            timerStatus: 'PAUSED',
            turnEndsAt: event.payload.turnEndsAt ?? null,
          }));
          break;
        case 'TOURNAMENT_RESUMED':
          setTimerMeta(prev => ({
            ...prev,
            timerStatus: 'RUNNING',
            turnEndsAt: event.payload.turnEndsAt || prev.turnEndsAt,
            durationSeconds: event.payload.durationSeconds || prev.durationSeconds
          }));
          break;
        case 'PUZZLE_ROTATE':
          setPuzzles(prev => prev.map(p =>
            p.puzzleId === event.payload.puzzleId
              ? { ...p, currentGrid: event.payload.currentGrid, fromPlayer: event.payload.fromPlayerName }
              : p
          ));
          break;
        case 'ROUND1_PUZZLE_SOLVED': {
          const { puzzleId, letter, solvedByName } = event.payload;
          setRound1Progress(prev => {
            const newSolved = { ...prev.solvedPuzzles, [puzzleId]: { letter, solvedByName } };
            const newClues = [...prev.clues];
            if (letter && !prev.clues.includes(letter)) {
              newClues.push(letter);
            }
            return { ...prev, solvedPuzzles: newSolved, clues: newClues };
          });
          setPuzzles(prev => prev.map(p =>
            p.puzzleId === puzzleId ? { ...p, isCompleted: true } : p
          ));
          callbacksRef.current.onLetterReveal?.(event.payload);
          break;
        }
        case 'ROUND1_FINAL_UNLOCKED': {
          const { clues, finalPuzzle } = event.payload;
          setRound1Progress(prev => ({
            ...prev,
            clues: clues || prev.clues,
            finalUnlocked: true,
            finalPuzzle: finalPuzzle
          }));
          if (finalPuzzle) {
            setPuzzles(prev => prev.map(p =>
              p.puzzleId === finalPuzzle.puzzleId ? { ...p, isLocked: false } : p
            ));
          }
          break;
        }
        case 'LETTER_REVEAL':
          callbacksRef.current.onLetterReveal?.(event.payload);
          break;

        // ===== Round 2 Events — Simultaneous Play =====
        case 'ROUND2_STARTED': {
          const payload = event.payload;
          setRound2State(prev => ({
            ...prev,
            playerOrder: payload.playerOrder || prev.playerOrder,
            playerNames: payload.playerNames || prev.playerNames,
            puzzles: payload.puzzles || prev.puzzles,
            assignedPuzzleId: payload.assignedPuzzleId ?? null,
            assignedPuzzle: payload.assignedPuzzle ?? null,
            rotationInterval: payload.rotationInterval || 60,
            nextRotationAt: payload.nextRotationAt || null,
            teamScore: payload.teamScore ?? prev.teamScore,
            solvedCount: payload.solvedCount ?? prev.solvedCount,
            totalPuzzles: payload.totalPuzzles || prev.totalPuzzles,
          }));
          break;
        }
        case 'ROUND2_PUZZLE_ASSIGNED': {
          const payload = event.payload;
          setRound2State(prev => ({
            ...prev,
            assignedPuzzleId: payload.puzzleId,
            assignedPuzzle: {
              puzzleId: payload.puzzleId,
              puzzleType: payload.puzzleType,
              orderInRound: payload.orderInRound,
              initialGrid: payload.initialGrid,
              currentGrid: payload.currentGrid || payload.initialGrid,
              points: payload.points,
              difficulty: payload.difficulty || 'MEDIUM'
            },
            nextRotationAt: payload.nextRotationAt || prev.nextRotationAt,
          }));
          break;
        }
        case 'ROUND2_ROTATION': {
          const payload = event.payload;
          // Rotation happened — clear the warning banner immediately
          setRotationWarning(false);
          if (warningTimerRef.current) {
            clearTimeout(warningTimerRef.current);
            warningTimerRef.current = null;
          }
          setRound2State(prev => ({
            ...prev,
            nextRotationAt: payload.nextRotationAt || null,
            playerOrder: payload.playerOrder || prev.playerOrder,
            playerNames: payload.playerNames || prev.playerNames,
            teamScore: payload.teamScore ?? prev.teamScore,
            solvedCount: payload.solvedCount ?? prev.solvedCount,
          }));
          break;
        }
        case 'ROUND2_PUZZLE_UPDATED': {
          const { puzzleId, currentGrid, row, col, value } = event.payload;
          setRound2State(prev => ({
            ...prev,
            puzzles: prev.puzzles.map(p => {
              if (p.puzzleId !== puzzleId) return p;
              if (currentGrid) {
                return { ...p, currentGrid };
              }
              if (p.currentGrid && row !== undefined && col !== undefined) {
                const newGrid = p.currentGrid.map(r => [...r]);
                newGrid[row][col] = value;
                return { ...p, currentGrid: newGrid };
              }
              return p;
            }),
            assignedPuzzle: prev.assignedPuzzle?.puzzleId === puzzleId
              ? { ...prev.assignedPuzzle, currentGrid: currentGrid || (prev.assignedPuzzle.currentGrid && row !== undefined && col !== undefined ? (() => {
                  const g = prev.assignedPuzzle.currentGrid.map(r => [...r]);
                  g[row][col] = value;
                  return g;
                })() : prev.assignedPuzzle.currentGrid) }
              : prev.assignedPuzzle
          }));
          break;
        }
        case 'ROUND2_PUZZLE_SOLVED': {
          const { puzzleId, difficulty, puzzlePoints, teamScore, solvedCount, allSolved, completionBonus } = event.payload;
          setRound2State(prev => ({
            ...prev,
            puzzles: prev.puzzles.map(p =>
              p.puzzleId === puzzleId
                ? { ...p, isCompleted: true }
                : p
            ),
            teamScore: teamScore ?? prev.teamScore,
            solvedCount: solvedCount ?? prev.solvedCount + 1,
            allSolved: allSolved ?? false,
            completionBonus: completionBonus ?? 0
          }));
          break;
        }

        // ===== Round 2: 5-second rotation warning =====
        case 'ROUND2_ROTATION_WARNING': {
          setRotationWarning(true);
          // Auto-clear after 5 seconds (matches the 5-second warning window)
          if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
          warningTimerRef.current = setTimeout(() => {
            setRotationWarning(false);
            warningTimerRef.current = null;
          }, 5000);
          break;
        }

        // ===== Round 3 Events — Collaboration =====
        case 'ROUND3_STATE_SYNC': {
          const payload = event.payload;
          setRound3State(prev => ({
            ...prev,
            puzzles: payload.puzzles || prev.puzzles,
            currentPuzzleId: payload.currentPuzzleId ?? prev.currentPuzzleId,
            cells: payload.cells || prev.cells,
            suggestions: payload.suggestions || prev.suggestions,
            suggestionVotes: payload.suggestionVotes || prev.suggestionVotes,
            playerFocuses: payload.playerFocuses || prev.playerFocuses,
            teamMembers: payload.teamMembers || prev.teamMembers,
            teamScore: payload.teamScore ?? prev.teamScore,
            solvedCount: payload.solvedCount ?? prev.solvedCount,
            totalPuzzles: payload.totalPuzzles || prev.totalPuzzles,
          }));
          // Mark synced players as active — only online ones
          if (payload.teamMembers?.length) {
            setActiveTeammates(prev => {
              const next = { ...prev };
              for (const m of payload.teamMembers) {
                // Normalize playerId to string for consistent Map keys
                const pid = String(m.playerId);
                if (m.online) {
                  next[pid] = { playerName: m.playerName, online: true };
                } else {
                  // Remove offline players so they don't appear in Team box
                  delete next[pid];
                }
              }
              return next;
            });
          }
          break;
        }
        case 'ROUND3_MOVE_PROPOSED': {
          const { puzzleId, row, col, value, playerId, playerName } = event.payload;
          const key = `${row}-${col}`;
          setRound3State(prev => ({
            ...prev,
            suggestions: {
              ...prev.suggestions,
              [key]: { value, playerId, playerName }
            }
          }));
          break;
        }
        case 'ROUND3_MOVE_ACCEPTED': {
          const { puzzleId, row, col, value, playerId, playerName, acceptedBy } = event.payload;
          const key = `${row}-${col}`;
          setRound3State(prev => {
            const newSuggestions = { ...prev.suggestions };
            delete newSuggestions[key];
            return {
              ...prev,
              cells: {
                ...prev.cells,
                [key]: { value, playerId, playerName }
              },
              suggestions: newSuggestions
            };
          });
          break;
        }
        case 'ROUND3_BOARD_UPDATED': {
          const { puzzleId, row, col, value, playerId, playerName } = event.payload;
          const key = `${row}-${col}`;
          setRound3State(prev => ({
            ...prev,
            cells: {
              ...prev.cells,
              [key]: { value, playerId, playerName }
            }
          }));
          break;
        }
        case 'ROUND3_MOVE_REJECTED': {
          const { puzzleId, row, col } = event.payload;
          const key = `${row}-${col}`;
          setRound3State(prev => {
            const newSuggestions = { ...prev.suggestions };
            delete newSuggestions[key];
            const newVotes = { ...prev.suggestionVotes };
            delete newVotes[key];
            return { ...prev, suggestions: newSuggestions, suggestionVotes: newVotes };
          });
          break;
        }
        case 'ROUND3_VOTE_CAST': {
          const { puzzleId, row, col, voterId, voteType, approveCount, requiredCount } = event.payload;
          const key = `${row}-${col}`;
          setRound3State(prev => {
            const existingVotes = prev.suggestionVotes[key] || [];
            let newVotes;
            if (voteType === 'approve') {
              newVotes = existingVotes.includes(voterId) ? existingVotes : [...existingVotes, voterId];
            } else {
              newVotes = existingVotes.filter(v => v !== voterId);
            }
            return {
              ...prev,
              suggestionVotes: { ...prev.suggestionVotes, [key]: newVotes }
            };
          });
          break;
        }
        case 'ROUND3_FOCUS_UPDATE': {
          const { puzzleId, playerId, playerName, row, col } = event.payload;
          setRound3State(prev => ({
            ...prev,
            playerFocuses: {
              ...prev.playerFocuses,
              [playerId]: { row, col, playerName }
            }
          }));
          break;
        }
        case 'TEAM_PUZZLE_NEXT': {
          const { puzzleId, difficulty, points } = event.payload;
          setRound3State(prev => ({
            ...prev,
            currentPuzzleId: puzzleId ?? prev.currentPuzzleId,
            cells: {},
            suggestions: {},
            playerFocuses: {}
          }));
          break;
        }

        default:
          break;
      }
    });

    return () => {
      if (tournamentId) leaveRoom(tournamentId);
      cleanup();
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }
    };
  }, [user, tournamentId]);

  const onLetterReveal = (cb) => { callbacksRef.current.onLetterReveal = cb; };

  const updateCell = (roundId, puzzleId, row, col, value) => {
    socketCellUpdate(roundId, puzzleId, row, col, value);
  };

  // R3 collaboration actions
  const proposeCell = (tournamentId, roundId, puzzleId, row, col, value) => {
    socketPropose(tournamentId, roundId, puzzleId, row, col, value);
  };

  const acceptProposal = (tournamentId, roundId, puzzleId, row, col) => {
    socketAccept(tournamentId, roundId, puzzleId, row, col);
  };

  const rejectProposal = (tournamentId, roundId, puzzleId, row, col) => {
    socketReject(tournamentId, roundId, puzzleId, row, col);
  };

  const withdrawProposal = (tournamentId, roundId, puzzleId, row, col) => {
    socketWithdraw(tournamentId, roundId, puzzleId, row, col);
  };

  const focusUpdate = (tournamentId, roundId, puzzleId, row, col) => {
    socketFocus(tournamentId, roundId, puzzleId, row, col);
  };

  const setRound2FromRest = useCallback((data) => {
    setRound2State(prev => ({
      ...prev,
      playerOrder: data.playerOrder || prev.playerOrder,
      playerNames: data.playerNames || prev.playerNames,
      puzzles: data.puzzles || prev.puzzles,
      assignedPuzzleId: data.assignedPuzzleId ?? prev.assignedPuzzleId,
      assignedPuzzle: data.assignedPuzzle ?? prev.assignedPuzzle,
      rotationInterval: data.rotationInterval || prev.rotationInterval,
      nextRotationAt: data.nextRotationAt || prev.nextRotationAt,
      teamScore: data.teamScore ?? prev.teamScore,
      solvedCount: data.solvedCount ?? prev.solvedCount,
      totalPuzzles: data.totalPuzzles || prev.totalPuzzles,
      allSolved: data.allSolved ?? prev.allSolved,
    }));
  }, []);

  const setRound3FromRest = useCallback((data) => {
    setRound3State(prev => ({
      ...prev,
      puzzles: data.puzzles || prev.puzzles,
      currentPuzzleId: data.currentPuzzleId ?? prev.currentPuzzleId,
      cells: data.cells || prev.cells,
      suggestions: data.suggestions || prev.suggestions,
      suggestionVotes: data.suggestionVotes || prev.suggestionVotes,
      playerFocuses: data.playerFocuses || prev.playerFocuses,
      teamScore: data.teamScore ?? prev.teamScore,
      solvedCount: data.solvedCount ?? prev.solvedCount,
      totalPuzzles: data.totalPuzzles || prev.totalPuzzles,
    }));
  }, []);

  const setTimerMetaFromRest = useCallback((data) => {
    setTimerMeta({
      turnEndsAt: data.turnEndsAt || null,
      timerStatus: data.timerStatus || 'UNKNOWN',
      durationSeconds: data.durationSeconds || 0
    });
  }, []);

  return {
    events, connected, puzzles, timerMeta, scoreUpdates,
    round1Progress, round2State, round3State, rotationWarning, activeTeammates,
    onLetterReveal, updateCell,
    proposeCell, acceptProposal, rejectProposal, withdrawProposal, focusUpdate,
    setRound2FromRest, setRound3FromRest, setTimerMetaFromRest
  };
}
