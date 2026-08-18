/**
 * env — a tiny wrapper around Vite's import.meta.env so the rest of the app
 * doesn't reach into Vite internals. Centralising this means a future build
 * tool swap (or a test that needs to flip the dev flag) changes one file.
 *
 * `DEV` is true under `vite` and `vite dev`, false under `vite build`. We
 * expose a function (not a constant) so tests can't accidentally capture a
 * stale value at module load.
 */
export function isDev() {
  return Boolean(import.meta.env && import.meta.env.DEV);
}

export function isProd() {
  return !isDev();
}
