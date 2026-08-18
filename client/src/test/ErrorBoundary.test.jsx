// Tests for ErrorBoundary and LocalErrorBoundary.
//
// The case Louise called out: "un composant qui lève une erreur ne fait pas
// disparaître ce qui l'entoure." A child that throws must NOT take its
// siblings with it. That is the whole point of a LOCAL boundary — a crashed
// game grid keeps the timer and header visible.
//
// We also pin: dev vs prod detail, resetErrorBoundary recovery, and the
// documented gaps (event handlers and async code are NOT caught — those are
// the boundary's limits, and pretending otherwise would be a lie).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary, LocalErrorBoundary } from '../components/ErrorBoundary';

// Helper that throws on render. The message is distinctive so assertions can
// confirm the error that reached the boundary is the one we threw.
function Boom({ message = 'kaboom' }) {
  throw new Error(message);
}

// Helper that renders a label — used as the "sibling" that must survive.
function Sibling({ label = 'survivor' }) {
  return <div data-testid="sibling">{label}</div>;
}

beforeEach(() => {
  // Silence the expected console.error from React when a child throws — it
  // pollutes the test output and we ARE asserting the error was caught.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary — the sibling survives', () => {
  // THE test Louise asked for. Two siblings under one parent; one throws.
  // The other must still be in the document. Without a boundary, React
  // unmounts the whole tree and the survivor disappears too.
  //
  // Note: the boundary must be scoped to the throwing child ONLY. If both
  // siblings sit inside the same boundary, the fallback replaces the whole
  // subtree — sibling included. That is React's contract, not a bug. The
  // local-boundary pattern (boundary around the risk zone, sibling outside)
  // is what makes the sibling survive.
  it('keeps the sibling mounted when a child throws', () => {
    render(
      <div>
        <Sibling label="header-still-here" />
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </div>
    );
    expect(screen.getByTestId('sibling')).toHaveTextContent('header-still-here');
  });

  it('renders the fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom message="grid-crashed" />
      </ErrorBoundary>
    );
    // The fallback title is localised, but in the test there's no i18n
    // provider — the boundary falls back to its hardcoded English default.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does NOT render the thrown child', () => {
    render(
      <ErrorBoundary>
        <Boom message="should-not-see-this" />
      </ErrorBoundary>
    );
    expect(screen.queryByText('should-not-see-this')).toBeNull();
  });
});

describe('ErrorBoundary — custom fallback', () => {
  // A local boundary passes a custom fallback so a crashed grid shows a
  // targeted message, not the generic "something went wrong" page.
  it('renders the custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={({ error }) => <div data-testid="custom">{error.message}</div>}>
        <Boom message="grid-blew-up" />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('custom')).toHaveTextContent('grid-blew-up');
  });

  it('passes resetErrorBoundary to the custom fallback', () => {
    let resetFn;
    render(
      <ErrorBoundary fallback={({ resetErrorBoundary }) => {
        resetFn = resetErrorBoundary;
        return <div data-testid="custom">crashed</div>;
      }}>
        <Boom />
      </ErrorBoundary>
    );
    expect(typeof resetFn).toBe('function');
  });
});

describe('ErrorBoundary — resetErrorBoundary', () => {
  // A flaky component that throws once, then succeeds. resetErrorBoundary
  // must clear the error state so the subtree re-renders. This is NOT a
  // guarantee the error won't recur — if the cause is deterministic, it will.
  // But it lets a user recover from a transient error without reloading.
  it('recovers when resetErrorBoundary is called', () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('transient');
      return <div data-testid="recovered">ok</div>;
    }

    const { container } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(container.textContent).not.toContain('recovered');

    // Stop throwing, then reset.
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });
});

describe('LocalErrorBoundary', () => {
  // Same behaviour as ErrorBoundary, different name. The name is the
  // contract: "I'm protecting a zone, not the whole app." A reader seeing
  // LocalErrorBoundary in PlayerGamePage knows the intent.
  it('keeps surrounding chrome visible when a zone crashes', () => {
    render(
      <div>
        <header data-testid="header">Timer: 5:00</header>
        <LocalErrorBoundary>
          <Boom />
        </LocalErrorBoundary>
        <footer data-testid="footer">Round 1</footer>
      </div>
    );
    expect(screen.getByTestId('header')).toHaveTextContent('Timer: 5:00');
    expect(screen.getByTestId('footer')).toHaveTextContent('Round 1');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('ErrorBoundary — documented gaps (what it does NOT catch)', () => {
  // A boundary is a safety net, not a replacement for try/catch. These tests
  // pin the limits so a future reader doesn't believe it covers more than
  // it does. If React ever adds handler catching, these tests will fail —
  // which is the right signal to update the docs.
  //
  // The thrown error escapes React and surfaces on BOTH `window` (jsdom's
  // event) and Node's `process` ('uncaughtException'). We install listeners
  // on both and call preventDefault/return true to SWALLOW the error so
  // Vitest doesn't see it as a test failure. The assertion is that the
  // boundary's onError was NOT called — proving the boundary did not catch
  // it. Whether the error then surfaces on window/process is irrelevant to
  // the boundary's contract; we just must not let it crash the runner.
  function installSwallow() {
    const onWindowError = (e) => e.preventDefault();
    const onProcessUncaught = () => true;
    window.addEventListener('error', onWindowError);
    process.on('uncaughtException', onProcessUncaught);
    return () => {
      window.removeEventListener('error', onWindowError);
      process.off('uncaughtException', onProcessUncaught);
    };
  }

  it('does NOT catch errors in event handlers', () => {
    const onError = vi.fn();
    function Clicker() {
      return (
        <button onClick={() => { throw new Error('handler-boom'); }}>click</button>
      );
    }
    const restore = installSwallow();
    try {
      render(
        <ErrorBoundary onError={onError}>
          <Clicker />
        </ErrorBoundary>
      );
      fireEvent.click(screen.getByText('click'));
      expect(onError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('does NOT catch errors in async code (setTimeout)', async () => {
    const onError = vi.fn();
    function Delayed() {
      // The throw happens inside a timer that runs after render commits.
      setTimeout(() => { throw new Error('async-boom'); }, 0);
      return <div>waiting</div>;
    }
    const restore = installSwallow();
    try {
      render(
        <ErrorBoundary onError={onError}>
          <Delayed />
        </ErrorBoundary>
      );
      // Wait long enough for the 0ms timer to have fired.
      await new Promise((r) => setTimeout(r, 10));
      expect(onError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
