/**
 * ErrorBoundary — React error boundaries for the Sudoku Arena client.
 *
 * Why this exists: without a boundary, any exception in render makes React
 * unmount the WHOLE tree — the user gets a blank page. Mid-competition, that
 * means a player loses their timer, their header, and any path back. Louise
 *'s strategy: a GLOBAL boundary around the app, plus LOCAL boundaries on
 * zones where a crash must NOT take the surrounding chrome with it.
 *
 * What a boundary CATCHES:
 *   - exceptions thrown during render
 *   - exceptions thrown in lifecycle methods (constructor, componentDidMount,
 *     shouldComponentUpdate, etc.)
 *   - exceptions thrown in class component render trees below it
 *
 * What a boundary does NOT catch:
 *   - event handlers (onClick, onSubmit) — those run outside render
 *   - async code (setTimeout, promise .then) — they run after render commits
 *   - errors thrown in the boundary's OWN error UI
 *
 * The gaps are real and documented below. The global boundary is a safety net,
 * not a replacement for try/catch in handlers. The local boundaries are the
 * ones that earn their keep: a crashed game grid keeps the timer visible.
 *
 * Dev vs prod: Louise decided — generic message in production, technical detail
 * in development. Vite exposes `import.meta.env.DEV` (true under `vite` /
`vite dev`, false under `vite build`). We branch on that. A player must NEVER
 * see a stack trace or a file path.
 */
import { Component, useContext } from 'react';
import { LanguageContext } from '../i18n/LanguageContext';
import { isDev } from './env';

// Last-resort strings, used only when the fallback renders outside a
// LanguageProvider. See the note in DefaultFallback for why this matters.
const UNTRANSLATED = {
  'errors.boundaryTitle': 'Something went wrong',
  'errors.boundaryMessage': 'An unexpected error occurred. Try reloading the page.',
  'errors.retry': 'Try again',
};

/**
 * Default fallback UI. Shared by the global boundary and any local boundary
 * that doesn't override it. In dev, the technical detail is shown so Louise
 * can debug without opening the console; in prod, only a generic message.
 *
 * The detail is a <pre> because it's typically a multi-line stack — and it's
 * only rendered in dev, so the layout being utilitarian is fine.
 */
// A class component cannot call hooks, but this fallback is a function
// component — it can, whoever renders it. It must be translated: every
// Chinese user would otherwise meet an English message on the worst possible
// screen.
//
// It reads the context DIRECTLY rather than through useLanguage(), which
// throws when no provider is mounted. Throwing here would be the one failure
// this whole file exists to prevent — an exception inside the error UI is not
// caught by anything and takes the app down. So: no provider, English
// literals, no crash.
function DefaultFallback({ error, resetErrorBoundary }) {
  const ctx = useContext(LanguageContext);
  const t = ctx?.t ?? ((key) => UNTRANSLATED[key] ?? key);
  const title = t('errors.boundaryTitle');
  const message = t('errors.boundaryMessage');
  const retry = t('errors.retry');
  return (
    <div className="flex flex-col items-center justify-center p-6 text-center" role="alert">
      <h2 className="text-base sm:text-lg font-semibold text-red-600 mb-2">{title}</h2>
      <p className="text-gray-600 text-xs sm:text-sm mb-4">{message}</p>
      {isDev() && error && (
        <pre className="bg-gray-100 border border-gray-300 rounded p-3 text-left text-xs text-red-800 overflow-x-auto max-w-full mb-4">
          {error.name}: {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
      )}
      {resetErrorBoundary && (
        <button
          onClick={resetErrorBoundary}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs sm:text-sm"
        >
          {retry}
        </button>
      )}
    </div>
  );
}

/**
 * ErrorBoundary — class component (React still requires a class for
 * getDerivedStateFromError / componentDidCatch; hooks don't have an equivalent).
 *
 * Props:
 *   - children: the subtree to protect
 *   - fallback (optional): a render prop `(args) => ReactNode` where args =
 *     { error, resetErrorBoundary }. If omitted, DefaultFallback is used.
 *     Local boundaries pass a custom fallback so a crashed grid keeps the
 *     surrounding layout.
 *   - onError (optional): called with (error, info) in componentDidCatch.
 *     Hook for logging — we don't ship a logger, but the seam is here.
 *
 * Reset semantics: `resetErrorBoundary` clears the error state so the subtree
 * re-renders. This is NOT a guarantee the error won't recur — if the cause is
 * deterministic (bad data), it will. But it lets a user recover from a
 * transient error without reloading the page.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The seam for logging. We deliberately do not console.error here in
    // production — the dev fallback already shows the stack, and spamming the
    // console in prod serves no one. In dev, the visible fallback is enough.
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        // A logger that throws must not take the boundary down with it.
      }
    }
  }

  resetErrorBoundary = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;
    if (error) {
      const args = { error, resetErrorBoundary: this.resetErrorBoundary };
      if (typeof fallback === 'function') return fallback(args);
      return <DefaultFallback {...args} />;
    }
    return children;
  }
}

/**
 * LocalErrorBoundary — thin wrapper for zone-level protection. Same behaviour
 * as ErrorBoundary, but the default fallback is smaller (a local zone, not a
 * full page) so it doesn't pretend to be the whole app. Callers can pass a
 * custom fallback for tighter integration (e.g. keep the timer visible above
 * a crashed game grid).
 *
 * Why a separate export instead of reusing ErrorBoundary: the distinction is
 * documentation. When a reader sees <LocalErrorBoundary> in PlayerGamePage,
 * they know the intent — protect a zone, not the app. The behaviour is the
 * same; the name carries the contract.
 */
export function LocalErrorBoundary({ children, fallback }) {
  return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>;
}

export default ErrorBoundary;
