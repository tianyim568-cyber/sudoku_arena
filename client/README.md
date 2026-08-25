# Sudoku Arena — Frontend

React 19 + Vite + Tailwind + plain JavaScript client for the Sudoku Arena
competition platform.

**For everything — install, run, tests, stack, deployment — see the
project root README:** [`../README.md`](../README.md).

## Common commands from this folder

```powershell
npm install                # install deps (once)
npm run dev                # dev server on http://localhost:5173 (proxies /api to :3001)
npm test -- --run          # Vitest, 367 tests
npm run lint               # oxlint, expected: 0 warnings
npm run build              # production build to dist/
```

The dev server expects the API to run at `http://localhost:3001` — start it with
`cd ../server && npm run dev` in another terminal.
