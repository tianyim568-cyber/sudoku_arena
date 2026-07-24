# Sudoku Arena — Frontend Documentation

## Overview

This document provides a comprehensive guide to the Sudoku Arena frontend codebase, designed for junior frontend developers. The application is a React-based real-time multiplayer Sudoku game with WebSocket synchronization.

**Target Audience:** Junior frontend developers joining the project or contributing to UI features.

**Prerequisites:** Basic React knowledge (hooks, components, state), understanding of ES6+ JavaScript, familiarity with REST APIs.

---

## Project Setup

### Technology Stack

- **Framework:** React 19 (latest)
- **Build Tool:** Vite 8 (ESM, fast HMR)
- **Routing:** React Router v7
- **Real-time:** Socket.IO Client 4.8
- **Styling:** Tailwind CSS v4 (utility-first)
- **HTTP Client:** Native `fetch` API (custom wrapper)

### Development Environment

**Prerequisites:**
- Node.js 20+ (LTS)
- npm 10+
- Backend server running on `localhost:301`

**Installation:**

```bash
cd client
npm install
```

**Start Development Server:**

```bash
npm run dev
```

The app runs on `http://localhost:5173` with automatic proxy to backend (`/api` and `/socket.io` → `localhost:3001`).

**Build for Production:**

```bash
npm run build
```

Output: `client/dist/` (static files ready for deployment).

---

## Application Structure

### Directory Layout

```
client/
├── src/
│   ├── api/                  # API layer (REST + WebSocket)
│   │   ├── index.js          # REST client wrapper
│   │   └── socket.js         # Socket.IO client wrapper
│   ├── components/           # Reusable UI components
│   │   ├── SudokuGrid.jsx    # 9x9 grid input (core component)
│   │   ├── TimerDisplay.jsx  # Countdown timer bar
│   │   └── PuzzleBoard.jsx   # Round 2 puzzle status grid
│   ├── hooks/                # Custom React hooks
│   │   ├── useAuth.jsx       # Authentication state + login/logout
│   │   ├── useGameSocket.js  # WebSocket state management (~500 lines)
│   │   └── useTimer.js       # Timer countdown with requestAnimationFrame
│   ├── pages/                # Route-level components
│   │   ├── LoginPage.jsx
│   │   ├── TournamentListPage.jsx
│   │   ├── TournamentDetailPage.jsx
│   │   ├── PlayerGamePage.jsx
│   │   ├── JudgeControlPage.jsx
│   │   ├── PuzzleBankPage.jsx
│   │   ├── Round1View.jsx    # Round 1 UI (Nine-One)
│   │   ├── Round2View.jsx    # Round 2 UI (Relay)
│   │   └── Round3View.jsx    # Round 3 UI (Collaborate)
│   ├── App.jsx               # Router + AuthProvider
│   ├── main.jsx              # Entry point
│   └── index.css             # Global styles (Tailwind import)
├── index.html                # HTML template
└── vite.config.js            # Vite configuration
```

### Key Architectural Decisions

**1. Component Hierarchy:**
- **Pages** are route-level containers (fetch data, manage state).
- **Views** (Round1View, Round2View, Round3View) are presentational components receiving props.
- **Components** are reusable UI elements (SudokuGrid, TimerDisplay).

**2. State Management:**
- **Local state:** `useState` for UI state (form inputs, modals).
- **Global state:** `useAuth` context for authentication.
- **Game state:** `useGameSocket` hook manages all real-time game data.
- **No Redux/Zustand:** Hooks are sufficient for this app's complexity.

**3. API Layer Separation:**
- `api/index.js`: REST calls (fetch-based, returns `{ code, data, message }`).
- `api/socket.js`: WebSocket events (Socket.IO wrapper, emits/listens on `'event'` channel).

---

## Routing & Navigation

### Route Configuration

Defined in `App.jsx` using React Router v7:

| Path | Component | Auth | Role | Description |
|------|-----------|------|------|-------------|
| `/login` | LoginPage | Public | — | Login form |
| `/` | TournamentListPage | Private | — | List all tournaments |
| `/tournament/:id` | TournamentDetailPage | Private | — | Tournament setup |
| `/play/:tournamentId` | PlayerGamePage | Private | PLAYER | Player game view |
| `/judge/:tournamentId` | JudgeControlPage | Private | JUDGE/ADMIN | Judge control panel |
| `/puzzle-bank` | PuzzleBankPage | Private | ADMIN | Puzzle bank management |

### Route Guards

**PrivateRoute:** Wraps routes requiring authentication. Redirects to `/login` if no user.

```jsx
function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div>加载中...</div>;
  if (!user) return <Navigate to="/login" />;
  return children;
}
```

**RoleRoute:** Restricts access by user role. Redirects to `/` if role mismatch.

```jsx
function RoleRoute({ children, roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <Navigate to="/" />;
  return children;
}
```

### Navigation Patterns

**Programmatic Navigation:** Use `useNavigate()` hook:

```jsx
const navigate = useNavigate();
navigate(`/tournament/${tournamentId}`);
```

**Links:** Use `<Link to="...">` for declarative navigation (not used in this app — all navigation is programmatic).

---

## Authentication Flow

### useAuth Hook

**Location:** `hooks/useAuth.jsx`

**Provides:**
- `user`: Current user object (`{ id, username, role, displayName }`) or `null`.
- `loading`: Boolean indicating auth state initialization.
- `login(username, password)`: Async function, returns `{ code, data, message }`.
- `logout()`: Clears token and user state.

**Implementation:**

1. **On Mount:** Check `localStorage.getItem('token')`. If exists, validate via `GET /api/auth/me`.
2. **Login:** POST `/api/auth/login`, store token in `localStorage`, set `api.token` header.
3. **Logout:** Clear `localStorage` and `api.token`, set `user = null`.

**Usage:**

```jsx
const { user, login, logout } = useAuth();

if (!user) return <LoginPage />;
return <Dashboard />;
```

### API Token Management

**Location:** `api/index.js`

The `api` object has a `token` property that's automatically attached to all requests:

```javascript
api.token = 'Bearer <jwt>';
const res = await api.request('GET', '/tournaments');
// Headers: { Authorization: 'Bearer <jwt>' }
```

**Token Persistence:** Token stored in `localStorage` (survives page refresh).

**Security Note:** No refresh token mechanism. Token expires after 24 hours, requiring re-login.

---

## Core Components

### SudokuGrid

**Location:** `components/SudokuGrid.jsx` (~300 lines)

**Purpose:** Renders a 9x9 Sudoku grid with cell input, validation, and round-specific behavior.

**Props:**

```typescript
{
  initialGrid: number[][],      // Starting puzzle state (0 = empty)
  currentGrid: number[][],      // Current state with user fills
  roundType: string,            // 'ROUND1_NINE_ONE' | 'ROUND2_RELAY' | 'ROUND3_COLLABORATE'
  difficulty: string,           // 'EASY' | 'MEDIUM' | 'HARD'
  onCellChange?: (row, col, value) => void,  // R2: real-time updates
  onFullGridSubmit?: (grid) => void,         // R1 FINAL + R2: submit full grid
  // R3-specific props
  proposals?: object,           // Pending cell proposals
  playerFocuses?: object,       // Teammate cursor positions
  onProposeCell?: (row, col, value) => void,
  onAcceptProposal?: (row, col) => void,
  onRejectProposal?: (row, col) => void,
  onWithdrawProposal?: (row, col) => void,
  onFocusUpdate?: (row, col) => void
}
```

**Key Features:**

1. **Cell Input:** Click cell → type number (1-9) → backspace to clear.
2. **Validation:** Highlights conflicts (duplicate numbers in row/col/box).
3. **Round-Specific Behavior:**
   - **R1 JOC:** Only 1 empty cell, single-cell submission.
   - **R1 FINAL:** Full grid submission via button.
   - **R2:** Real-time `onCellChange` emits WebSocket updates.
   - **R3:** Proposal workflow (propose → accept/reject → consensus).
4. **Visual Indicators:**
   - Initial cells: Dark background, non-editable.
   - User fills: Light background, editable.
   - Conflicts: Red border.
   - Proposals (R3): Yellow highlight with vote count.

**Usage:**

```jsx
<SudokuGrid
  initialGrid={puzzle.initialGrid}
  currentGrid={puzzle.currentGrid}
  roundType="ROUND2_RELAY"
  onCellChange={(row, col, value) => updateCell(row, col, value)}
  onFullGridSubmit={(grid) => submitGrid(grid)}
/>
```

**Common Pitfalls:**

- **Grid Mutation:** Never mutate `currentGrid` directly. Always create a new array:
  ```javascript
  const newGrid = currentGrid.map((row, ri) =>
    row.map((cell, ci) => (ri === row && ci === col ? value : cell))
  );
  onFullGridSubmit(newGrid);
  ```

- **R3 Proposal State:** Proposals are managed externally (via `useGameSocket`). Grid component only renders them.

---

### TimerDisplay

**Location:** `components/TimerDisplay.jsx`

**Purpose:** Renders a countdown timer with color transitions (green → yellow → red).

**Props:**

```typescript
{
  remainingSeconds: number,     // Seconds remaining
  totalSeconds: number,         // Total duration (for progress bar)
  formattedTime: string,        // 'MM:SS' format
  isPaused: boolean             // Pause state
}
```

**Visual Behavior:**
- **> 60s:** Green bar
- **30-60s:** Yellow bar
- **< 30s:** Red bar + pulse animation
- **Paused:** Gray overlay with "已暂停" text

**Usage:**

```jsx
<TimerDisplay
  remainingSeconds={remaining}
  totalSeconds={300}
  formattedTime="04:32"
  isPaused={false}
/>
```

---

### PuzzleBoard

**Location:** `components/PuzzleBoard.jsx`

**Purpose:** Round 2 puzzle status grid (4x4 layout showing 16 puzzles).

**Props:**

```typescript
{
  puzzles: Array<{
    puzzleId: number,
    difficulty: string,
    points: number,
    isCompleted: boolean,
    orderInRound: number
  }>,
  solvedCount: number,
  totalPuzzles: number,
  assignedPuzzleId: number | null,
  onSelectPuzzle?: (puzzle) => void
}
```

**Visual Indicators:**
- **Assigned:** Blue border (player's current puzzle).
- **Completed:** Green background + checkmark.
- **Available:** Gray background.
- **Difficulty Badge:** E/M/H color-coded.

**Usage:**

```jsx
<PuzzleBoard
  puzzles={round2State.puzzles}
  solvedCount={round2State.solvedCount}
  totalPuzzles={16}
  assignedPuzzleId={round2State.assignedPuzzle?.puzzleId}
  onSelectPuzzle={(p) => setActivePuzzle(p)}
/>
```

---

## Custom Hooks

### useAuth

**Location:** `hooks/useAuth.jsx`

**Purpose:** Authentication state management with context provider.

**Exports:**
- `AuthProvider`: Context provider component (wraps app).
- `useAuth()`: Hook returning `{ user, loading, login, logout }`.

**Implementation Details:**

```jsx
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.token = token;
      api.request('GET', '/auth/me')
        .then(res => {
          if (res.code === 200) setUser(res.data);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const res = await api.request('POST', '/auth/login', { username, password });
    if (res.code === 200) {
      localStorage.setItem('token', res.data.token);
      api.token = res.data.token;
      setUser(res.data.user);
    }
    return res;
  };

  const logout = () => {
    localStorage.removeItem('token');
    api.token = null;
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

**Usage:**

```jsx
function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await login(username, password);
    if (res.code !== 200) alert(res.message);
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

---

### useGameSocket

**Location:** `hooks/useGameSocket.js` (~500 lines)

**Purpose:** Central WebSocket state manager. Handles all real-time game events and maintains round-specific state.

**Parameters:**

```javascript
useGameSocket(tournamentId: number)
```

**Returns:**

```typescript
{
  // Connection state
  connected: boolean,

  // Puzzle data
  puzzles: Array<Puzzle>,
  activePuzzle: Puzzle | null,

  // Timer
  timerMeta: {
    turnEndsAt: number,        // Unix timestamp (ms)
    timerStatus: string,       // 'RUNNING' | 'PAUSED' | 'UNKNOWN'
    durationSeconds: number
  },

  // Round 1 state
  round1Progress: {
    solvedPuzzles: object,     // { puzzleId: true }
    clues: object,             // { puzzleId: letter }
    finalUnlocked: boolean,
    teamScore: number
  },

  // Round 2 state
  round2State: {
    playerOrder: number[],     // [userId, userId, ...]
    playerNames: object,       // { userId: displayName }
    puzzles: Array<Puzzle>,
    assignedPuzzle: Puzzle | null,
    teamScore: number,
    solvedCount: number,
    totalPuzzles: number,
    allSolved: boolean,
    completionBonus: number
  },

  // Round 3 state
  round3State: {
    puzzles: Array<Puzzle>,
    currentPuzzleId: number,
    cells: object,             // { 'row,col': value }
    suggestions: object,       // { 'row,col': { value, proposerId, votes } }
    suggestionVotes: object,
    playerFocuses: object,     // { userId: { row, col } }
    teamScore: number
  },

  // Events
  events: Array<{ type: string, payload: any }>,
  rotationWarning: boolean,
  activeTeammates: number[],

  // Actions
  updateCell: (roundId, puzzleId, row, col, value) => void,
  proposeCell: (tournamentId, roundId, puzzleId, row, col, value) => void,
  acceptProposal: (tournamentId, roundId, puzzleId, row, col) => void,
  rejectProposal: (tournamentId, roundId, puzzleId, row, col) => void,
  withdrawProposal: (tournamentId, roundId, puzzleId, row, col) => void,
  focusUpdate: (tournamentId, roundId, puzzleId, row, col) => void,

  // REST hydration
  setRound2FromRest: (state) => void,
  setRound3FromRest: (state) => void,
  setTimerMetaFromRest: (meta) => void,

  // Callbacks
  onLetterReveal: (callback) => void
}
```

**Implementation Overview:**

1. **Socket Connection:** Connects via `connectSocket(token)`, joins `tournament_{id}` room.
2. **Event Listener:** Listens on `'event'` channel, dispatches to switch/case handler.
3. **State Updates:** Updates local state based on event type (25+ event types).
4. **Action Emitters:** Wraps socket emit calls (updateCell, proposeCell, etc.).

**Key Event Types:**

| Event | Description | State Update |
|-------|-------------|--------------|
| `ROUND_STARTED` | Round begins | Reset puzzles, timer |
| `ROUND_FINISHED` | Round ends | Clear active puzzle |
| `PUZZLE_ASSIGNED` | Player receives puzzle | Set activePuzzle |
| `PUZZLE_SOLVED` | Team solves puzzle | Mark completed, update score |
| `CELL_FILL_ACK` | Cell update confirmed | Update currentGrid |
| `CELL_CONFLICT` | Cell already filled | Show error |
| `TIMER_TICK` | Timer recalibration | Update timerMeta |
| `ROTATION_WARNING` | 5s before R2 rotation | Set rotationWarning |
| `ROUND2_ROTATED` | R2 puzzles rotated | Update assignedPuzzle |
| `ROUND3_PROPOSAL` | New cell proposal | Add to suggestions |
| `ROUND3_VOTE` | Proposal voted | Update vote count |
| `ROUND3_CELL_FILLED` | Consensus reached | Move to cells, remove suggestion |

**Usage:**

```jsx
function PlayerGamePage() {
  const { tournamentId } = useParams();
  const {
    round2State,
    activePuzzle,
    updateCell,
    rotationWarning
  } = useGameSocket(parseInt(tournamentId));

  const handleCellChange = (row, col, value) => {
    updateCell(currentRound.roundId, activePuzzle.puzzleId, row, col, value);
  };

  return (
    <Round2View
      round2State={round2State}
      activePuzzle={activePuzzle}
      onCellChange={handleCellChange}
      rotationWarning={rotationWarning}
    />
  );
}
```

**Common Pitfalls:**

- **Tournament ID Type:** Must be a number, not string. Use `parseInt(tournamentId)` from URL params.
- **Socket Reconnection:** `connectSocket()` auto-rejoins tournament room on reconnect. Don't manually re-join.
- **State Hydration:** On page refresh, REST API (`getMyGameState`) populates initial state. Socket events update from there.

---

### useTimer

**Location:** `hooks/useTimer.js`

**Purpose:** Client-side countdown timer using `requestAnimationFrame` for smooth updates.

**Parameters:**

```javascript
useTimer(timerMeta: {
  turnEndsAt: number,
  timerStatus: string,
  durationSeconds: number
})
```

**Returns:**

```typescript
{
  remainingSeconds: number,     // Seconds remaining (0-3600)
  formattedTime: string,        // 'MM:SS' format
  isPaused: boolean
}
```

**Implementation:**

```javascript
export function useTimer(timerMeta) {
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const turnEndsAtRef = useRef(timerMeta.turnEndsAt);
  const timerStatusRef = useRef(timerMeta.timerStatus);

  // Update refs when timerMeta changes
  useEffect(() => {
    turnEndsAtRef.current = timerMeta.turnEndsAt;
    timerStatusRef.current = timerMeta.timerStatus;
  }, [timerMeta]);

  // requestAnimationFrame loop
  useEffect(() => {
    let rafId;
    const tick = () => {
      if (timerStatusRef.current === 'RUNNING' && turnEndsAtRef.current) {
        const remaining = Math.max(0, Math.ceil((turnEndsAtRef.current - Date.now()) / 1000));
        setRemainingSeconds(remaining);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const formattedTime = useMemo(() => {
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, [remainingSeconds]);

  return {
    remainingSeconds,
    formattedTime,
    isPaused: timerMeta.timerStatus === 'PAUSED'
  };
}
```

**Why requestAnimationFrame?**
- Smoother than `setInterval` (syncs with display refresh rate).
- Pauses automatically when tab is inactive (saves CPU).
- No drift (recalculates from `turnEndsAt` each frame).

**Usage:**

```jsx
function GameHeader({ timerMeta }) {
  const { remainingSeconds, formattedTime, isPaused } = useTimer(timerMeta);

  return (
    <div>
      <TimerDisplay
        remainingSeconds={remainingSeconds}
        totalSeconds={timerMeta.durationSeconds}
        formattedTime={formattedTime}
        isPaused={isPaused}
      />
    </div>
  );
}
```

---

## API Layer

### REST Client

**Location:** `api/index.js`

**Structure:**

```javascript
export const api = {
  token: null,

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = this.token;

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    return res.json(); // { code, data, message }
  },

  // Convenience methods
  getTournament(id) { return this.request('GET', `/tournaments/${id}`); },
  listTournaments() { return this.request('GET', '/tournaments'); },
  startTournament(id) { return this.request('POST', `/tournaments/${id}/start`); },
  // ... (30+ methods)
};
```

**Response Format:**

All endpoints return:

```typescript
{
  code: number,       // 200 = success, 40000+ = error
  data: any,          // Response payload
  message: string     // Error message (if code !== 200)
}
```

**Error Handling:**

```javascript
const res = await api.startTournament(id);
if (res.code === 200) {
  alert('Tournament started!');
} else {
  alert(`Error: ${res.message}`);
}
```

**Common Methods:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `api.listTournaments()` | GET /tournaments | List all tournaments |
| `api.getTournament(id)` | GET /tournaments/:id | Get tournament details |
| `api.startTournament(id)` | POST /tournaments/:id/start | Start tournament |
| `api.getMyGameState(tournamentId)` | GET /game/:id/my-state | Get player's current state |
| `api.generatePuzzles(roundType, teamsCount)` | POST /puzzle-bank/generate | Generate puzzles |
| `api.listRounds(tournamentId)` | GET /tournaments/:id/rounds | List rounds |

---

### WebSocket Client

**Location:** `api/socket.js`

**Connection:**

```javascript
import { io } from 'socket.io-client';

let socket = null;

export function connectSocket(token) {
  if (socket?.connected) return socket;

  socket = io({
    auth: { token },
    transports: ['websocket']
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  return socket;
}
```

**Room Management:**

```javascript
export function joinRoom(tournamentId) {
  socket.emit('join', { tournamentId });
}

export function joinTeam(teamId) {
  socket.emit('joinTeam', { teamId });
}

export function leaveRoom(tournamentId) {
  socket.emit('leave', { tournamentId });
}
```

**Event Emission:**

All game events use the `'event'` channel:

```javascript
export function submitAnswer(tournamentId, roundId, puzzleId, type, data) {
  socket.emit('event', {
    type: 'SUBMIT_ANSWER',
    payload: { tournamentId, roundId, puzzleId, submissionType: type, data }
  });
}

export function updateCell(roundId, puzzleId, row, col, value) {
  socket.emit('event', {
    type: 'ROUND2_CELL_UPDATE',
    payload: { roundId, puzzleId, row, col, value }
  });
}

export function proposeCell(tournamentId, roundId, puzzleId, row, col, value) {
  socket.emit('event', {
    type: 'ROUND3_PROPOSE_CELL',
    payload: { tournamentId, roundId, puzzleId, row, col, value }
  });
}
```

**Event Listening:**

```javascript
export function onEvent(callback) {
  socket.on('event', callback);
  return () => socket.off('event', callback);
}

// Usage:
const cleanup = onEvent((event) => {
  if (event.type === 'PUZZLE_SOLVED') {
    console.log('Puzzle solved!', event.payload);
  }
});

// Cleanup:
cleanup();
```

**Common Events:**

| Event Type | Direction | Description |
|------------|-----------|-------------|
| `SUBMIT_ANSWER` | Client → Server | Submit puzzle solution |
| `ROUND2_CELL_UPDATE` | Client → Server | R2 real-time cell update |
| `ROUND3_PROPOSE_CELL` | Client → Server | R3 propose cell value |
| `ROUND3_ACCEPT_PROPOSAL` | Client → Server | R3 accept proposal |
| `ROUND3_REJECT_PROPOSAL` | Client → Server | R3 reject proposal |
| `ROUND_STARTED` | Server → Client | Round begins |
| `PUZZLE_ASSIGNED` | Server → Client | Player receives puzzle |
| `PUZZLE_SOLVED` | Server → Client | Team solves puzzle |
| `TIMER_TICK` | Server → Client | Timer recalibration |
| `ROTATION_WARNING` | Server → Client | 5s before R2 rotation |

---

## Page Components

### LoginPage

**Location:** `pages/LoginPage.jsx`

**Purpose:** User authentication form with quick-login buttons for demo accounts.

**Key Features:**
- Username/password form
- Quick-login buttons (admin, judge, player1)
- Gradient background
- Error message display

**State:**

```javascript
const [username, setUsername] = useState('');
const [password, setPassword] = useState('');
const [error, setError] = useState('');
const [loading, setLoading] = useState(false);
```

**Submit Handler:**

```javascript
const handleSubmit = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError('');

  const res = await login(username, password);
  if (res.code === 200) {
    navigate('/');
  } else {
    setError(res.message || '登录失败');
  }
  setLoading(false);
};
```

**Quick Login:**

```javascript
const quickLogin = async (user, pass) => {
  const res = await login(user, pass);
  if (res.code !== 200) setError(res.message);
  else navigate('/');
};
```

---

### TournamentListPage

**Location:** `pages/TournamentListPage.jsx`

**Purpose:** List all tournaments with status badges and admin controls.

**Data Fetching:**

```javascript
const load = async () => {
  const res = await api.listTournaments();
  if (res.code === 200) setTournaments(res.data);
};

useEffect(() => { load(); }, []);
```

**Status Badges:**

```javascript
const statusColors = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-green-100 text-green-800',
  PAUSED: 'bg-orange-100 text-orange-800',
  FINISHED: 'bg-gray-100 text-gray-800'
};

const statusLabels = {
  PENDING: '未开始',
  IN_PROGRESS: '进行中',
  PAUSED: '已暂停',
  FINISHED: '已结束'
};
```

**Admin Actions:**
- Create tournament (modal form)
- Delete tournament (with confirmation)

---

### TournamentDetailPage

**Location:** `pages/TournamentDetailPage.jsx` (~400 lines)

**Purpose:** Tournament setup hub with readiness checklist, round creation, team management, and puzzle import.

**Key Sections:**

1. **Readiness Checklist:**
   - 3 rounds created?
   - Puzzles imported?
   - Teams created?
   - Judge assigned?

2. **Quick Setup Button:**
   - Auto-creates 3 rounds (R1, R2, R3)
   - Creates 2 teams with 4 players each
   - Assigns judge
   - Imports puzzles from bank

3. **Round Management:**
   - Create rounds (max 3)
   - Display round details (type, duration, puzzle count)

4. **Team Management:**
   - Create teams
   - Add members (dropdown of available players)
   - Remove members

5. **Puzzle Import:**
   - Select round
   - Import from puzzle bank
   - Check puzzle availability

**State:**

```javascript
const [tournament, setTournament] = useState(null);
const [rounds, setRounds] = useState([]);
const [teams, setTeams] = useState([]);
const [players, setPlayers] = useState([]);
const [judges, setJudges] = useState([]);
const [puzzleBank, setPuzzleBank] = useState({ r1: 0, r2: 0, r3: 0 });
```

**Readiness Logic:**

```javascript
const readiness = {
  hasThreeRounds: rounds.length === 3,
  hasPuzzles: rounds.every(r => r.puzzleCount > 0),
  hasTeams: teams.length >= 2,
  hasJudge: judges.length > 0
};

const isReady = Object.values(readiness).every(Boolean);
```

---

### PlayerGamePage

**Location:** `pages/PlayerGamePage.jsx` (~420 lines)

**Purpose:** Thin orchestrator for game play. Delegates rendering to Round1View, Round2View, or Round3View based on current round type.

**Key Responsibilities:**

1. **Load Tournament Info:**
   ```javascript
   useEffect(() => {
     api.getTournament(tournamentId).then(res => {
       if (res.code === 200) setTournament(res.data);
     });
   }, [tournamentId]);
   ```

2. **REST Fallback (Late Join / Refresh):**
   ```javascript
   useEffect(() => {
     api.getMyGameState(tournamentId).then(res => {
       if (res.code === 200 && res.data?.currentRound) {
         setCurrentRound(res.data.currentRound);
         setTimerMetaFromRest({ ... });
         setRound2FromRest(res.data.round2State);
         setRound3FromRest(res.data.round3State);
       }
     });
   }, [tournamentId]);
   ```

3. **Socket Event Handling:**
   ```javascript
   useEffect(() => {
     const latest = events[events.length - 1];
     if (!latest) return;

     switch (latest.type) {
       case 'ROUND_STARTED':
         setCurrentRound(latest.payload);
         setActivePuzzle(null);
         break;
       case 'PUZZLE_ASSIGNED':
         setActivePuzzle(latest.payload);
         break;
       case 'ANSWER_RESULT':
         showMessage(latest.payload.message);
         break;
       // ... (20+ event types)
     }
   }, [events]);
   ```

4. **Delegate to Round Views:**
   ```javascript
   return (
     <div>
       {isRound2 ? (
         <Round2View
           round2State={round2State}
           activePuzzle={activePuzzle}
           onCellChange={handleR2CellChange}
           rotationWarning={rotationWarning}
         />
       ) : isRound1 ? (
         <Round1View
           puzzles={puzzles}
           activePuzzle={activePuzzle}
           round1Progress={round1Progress}
           onSelectPuzzle={handleSelectPuzzle}
           onCellSubmit={handleCellSubmit}
         />
       ) : isRound3 ? (
         <Round3View
           round3State={round3State}
           activePuzzle={activePuzzle}
           onProposeCell={handleR3ProposeCell}
           onAcceptProposal={handleR3AcceptProposal}
         />
       ) : (
         <div>等待轮次开始...</div>
       )}
     </div>
   );
   ```

**Action Handlers:**

```javascript
// Round 1: Single cell submission
const handleCellSubmit = (row, col, value) => {
  submitAnswer(tournamentId, currentRound.roundId, activePuzzle.puzzleId, 'SINGLE_CELL', { row, col, value });
};

// Round 1/2: Full grid submission
const handleFullGridSubmit = (grid) => {
  submitAnswer(tournamentId, currentRound.roundId, activePuzzle.puzzleId, 'FULL_GRID', { grid });
};

// Round 2: Real-time cell updates
const handleR2CellChange = (row, col, value) => {
  updateCell(currentRound.roundId, activePuzzle.puzzleId, row, col, value);
};

// Round 3: Propose cell
const handleR3ProposeCell = (row, col, value) => {
  proposeCell(tournamentId, currentRound.roundId, activePuzzle.puzzleId, row, col, value);
};
```

---

### JudgeControlPage

**Location:** `pages/JudgeControlPage.jsx`

**Purpose:** Tournament control panel for judges (start/pause/resume/end, round controls, room status).

**Key Features:**

1. **Tournament Controls:**
   - Start tournament (if PENDING)
   - Pause/resume (if IN_PROGRESS)
   - End tournament

2. **Round Controls:**
   - Start round (if NOT_STARTED)
   - End round (if IN_PROGRESS)
   - Display remaining time

3. **Room Status (Polling):**
   ```javascript
   useEffect(() => {
     if (tournament?.status === 'IN_PROGRESS') {
       loadRoomStatus();
       const iv = setInterval(loadRoomStatus, 5000); // Poll every 5s
       return () => clearInterval(iv);
     }
   }, [tournament?.status]);
   ```

4. **Score Display:**
   - List team scores
   - Refresh button

---

### PuzzleBankPage

**Location:** `pages/PuzzleBankPage.jsx`

**Purpose:** Admin interface for puzzle bank management (generate, import, delete).

**Key Actions:**

1. **Bulk Generate:**
   ```javascript
   const handleBulkGenerate = async () => {
     const res = await api.generatePuzzlesBulk(teamsCount);
     if (res.code === 200) {
       alert(`Generated ${res.data.totalGenerated} puzzles`);
       load(); // Refresh list
     }
   };
   ```

2. **Per-Round Generate:**
   ```javascript
   const handleGenerate = async (roundType) => {
     const res = await api.generatePuzzles(roundType, 1);
     if (res.code === 200) {
       alert(`Generated ${res.data.generated} puzzles`);
       load();
     }
   };
   ```

3. **Import to Round:**
   ```javascript
   const handleImport = async () => {
     const res = await api.request('POST', '/puzzle-bank/import-to-round', {
       roundId: parseInt(selectedRound),
       count: 0 // Import all available
     });
     if (res.code === 200) alert(`Imported ${res.data.imported} puzzles`);
   };
   ```

4. **Delete/Clear:**
   ```javascript
   const handleDelete = async (id) => {
     if (!confirm('Delete this puzzle?')) return;
     const res = await api.deletePuzzleFromBank(id);
     if (res.code === 200) load();
   };

   const handleClearAll = async () => {
     if (!confirm('Clear all puzzles?')) return;
     if (!confirm('Are you sure?')) return; // Double confirm
     const res = await api.clearPuzzleBank();
     if (res.code === 200) load();
   };
   ```

---

## Styling with Tailwind CSS

### Setup

**Location:** `index.css`

```css
@import "tailwindcss";

body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

#root {
  min-height: 100vh;
}
```

**Tailwind v4:** Uses `@tailwindcss/vite` plugin (no `tailwind.config.js` needed).

### Common Patterns

**Card Layout:**

```jsx
<div className="bg-white rounded-xl shadow p-6">
  <h2 className="text-lg font-semibold mb-4">Title</h2>
  <p className="text-sm text-gray-600">Content</p>
</div>
```

**Button:**

```jsx
<button className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors">
  Click Me
</button>
```

**Status Badge:**

```jsx
<span className="px-3 py-1 rounded text-sm font-medium bg-green-600">
  进行中
</span>
```

**Flex Layout:**

```jsx
<div className="flex items-center justify-between gap-4">
  <div>Left</div>
  <div>Right</div>
</div>
```

**Grid Layout:**

```jsx
<div className="grid grid-cols-3 gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>
```

**Conditional Classes:**

```jsx
<div className={`p-4 ${isActive ? 'bg-blue-100' : 'bg-gray-100'}`}>
  Content
</div>
```

---

## Common Patterns & Best Practices

### 1. Data Fetching

**Pattern:** Fetch on mount, store in state, display loading/error.

```jsx
function TournamentListPage() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listTournaments()
      .then(res => {
        if (res.code === 200) setTournaments(res.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>加载中...</div>;
  return <div>{tournaments.map(t => <div key={t.id}>{t.name}</div>)}</div>;
}
```

### 2. Form Submission

**Pattern:** Prevent default, validate, submit, handle response.

```jsx
const handleSubmit = async (e) => {
  e.preventDefault();
  if (!username || !password) {
    setError('请填写所有字段');
    return;
  }

  setLoading(true);
  const res = await login(username, password);
  setLoading(false);

  if (res.code === 200) {
    navigate('/');
  } else {
    setError(res.message);
  }
};
```

### 3. Socket Event Handling

**Pattern:** Listen to events array, process latest event in switch/case.

```jsx
useEffect(() => {
  const latest = events[events.length - 1];
  if (!latest) return;

  switch (latest.type) {
    case 'PUZZLE_SOLVED':
      showMessage('Puzzle solved!');
      break;
    case 'ANSWER_RESULT':
      showMessage(latest.payload.message);
      break;
  }
}, [events]);
```

### 4. Memoization

**Pattern:** Use `useMemo` for expensive computations, `useCallback` for stable function references.

```jsx
const activePuzzle = useMemo(() => {
  if (round2State.assignedPuzzle) return round2State.assignedPuzzle;
  return activePuzzle;
}, [round2State.assignedPuzzle, activePuzzle]);

const handleCellChange = useCallback((row, col, value) => {
  updateCell(currentRound.roundId, activePuzzle.puzzleId, row, col, value);
}, [currentRound, activePuzzle, updateCell]);
```

### 5. Cleanup on Unmount

**Pattern:** Clear intervals, cancel subscriptions, abort requests.

```jsx
useEffect(() => {
  const iv = setInterval(loadRoomStatus, 5000);
  return () => clearInterval(iv); // Cleanup
}, []);

useEffect(() => {
  const controller = new AbortController();
  fetch('/api/data', { signal: controller.signal });
  return () => controller.abort(); // Cleanup
}, []);
```

---

## Debugging Tips

### 1. Socket Connection Issues

**Check:** Is socket connected?

```javascript
console.log('Socket connected:', socket.connected);
console.log('Socket ID:', socket.id);
```

**Check:** Are events being received?

```javascript
socket.on('event', (event) => {
  console.log('Event received:', event);
});
```

### 2. State Not Updating

**Check:** Is state being mutated directly?

```javascript
// BAD:
currentGrid[row][col] = value;
setCurrentGrid(currentGrid);

// GOOD:
const newGrid = currentGrid.map((r, ri) =>
  r.map((c, ci) => (ri === row && ci === col ? value : c))
);
setCurrentGrid(newGrid);
```

### 3. Timer Not Counting Down

**Check:** Is `timerMeta.turnEndsAt` set correctly?

```javascript
console.log('turnEndsAt:', timerMeta.turnEndsAt);
console.log('Current time:', Date.now());
console.log('Remaining:', (timerMeta.turnEndsAt - Date.now()) / 1000);
```

### 4. API Requests Failing

**Check:** Is token attached?

```javascript
console.log('Token:', api.token);
```

**Check:** Response code?

```javascript
const res = await api.getTournament(id);
console.log('Response:', res);
if (res.code !== 200) {
  console.error('Error:', res.message);
}
```

---

## Performance Optimization

### 1. Avoid Unnecessary Re-renders

**Problem:** Parent re-renders cause child re-renders.

**Solution:** Use `React.memo` for pure components:

```javascript
const SudokuGrid = React.memo(function SudokuGrid({ grid, onCellChange }) {
  // Component logic
});
```

### 2. Debounce Input Handlers

**Problem:** R2 `onCellChange` fires on every keystroke.

**Solution:** Debounce WebSocket emissions:

```javascript
const debouncedUpdateCell = useMemo(() => {
  return debounce((row, col, value) => {
    updateCell(roundId, puzzleId, row, col, value);
  }, 100);
}, [roundId, puzzleId, updateCell]);
```

### 3. Virtualize Large Lists

**Problem:** Rendering 100+ puzzles causes lag.

**Solution:** Use `react-window` or `react-virtualized` (not implemented in this app, but recommended for scale).

---

## Testing

### Current State

No automated tests in the frontend codebase.

### Recommended Testing Strategy

**1. Unit Tests (Jest + React Testing Library):**

```javascript
test('SudokuGrid renders 9x9 grid', () => {
  render(<SudokuGrid initialGrid={mockGrid} currentGrid={mockGrid} />);
  const cells = screen.getAllByRole('gridcell');
  expect(cells).toHaveLength(81);
});
```

**2. Integration Tests:**

```javascript
test('Login redirects to tournament list', async () => {
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
  fireEvent.click(screen.getByText('登录'));
  await waitFor(() => expect(window.location.pathname).toBe('/'));
});
```

**3. E2E Tests (Playwright):**

```javascript
test('Player can submit puzzle', async ({ page }) => {
  await page.goto('/play/1');
  await page.click('[data-cell="0-0"]');
  await page.keyboard.type('5');
  await page.click('text=提交');
  await expect(page.locator('text=正确')).toBeVisible();
});
```

---

## Common Issues & Solutions

### Issue: Socket Disconnects Frequently

**Cause:** Network instability or server restart.

**Solution:** Socket.IO auto-reconnects. Check `socket.on('reconnect', ...)` handler.

### Issue: Timer Drift

**Cause:** Client clock out of sync with server.

**Solution:** Server sends `TIMER_TICK` every 10s to recalibrate. Client uses `turnEndsAt` (not local countdown).

### Issue: Puzzle State Not Persisting

**Cause:** Page refresh clears `useGameSocket` state.

**Solution:** REST fallback (`getMyGameState`) hydrates state on mount.

### Issue: R2 Rotation Not Working

**Cause:** `rotationWarning` not set or countdown not triggered.

**Solution:** Check `Round2NotificationService` on backend emits `ROTATION_WARNING` event.

---

## Conclusion

This frontend codebase demonstrates solid React patterns (hooks, context, component composition) with real-time WebSocket integration. The architecture is clean and maintainable, with clear separation between API layer, state management, and UI components.

**Key Takeaways:**
- Hooks (`useAuth`, `useGameSocket`, `useTimer`) encapsulate complex logic.
- Components are reusable and props-driven.
- Socket events are centralized in `useGameSocket` for easy debugging.
- Tailwind CSS provides rapid, consistent styling.

**Next Steps for New Developers:**
1. Read `useGameSocket.js` thoroughly (it's the heart of the app).
2. Experiment with `SudokuGrid` component (try adding new visual features).
3. Add unit tests for critical components.
4. Implement error boundaries for graceful error handling.

---

**Document Version:** 1.0  
**Last Updated:** 2026-07-24  
**Audience:** Junior Frontend Developers  
**Language:** English
