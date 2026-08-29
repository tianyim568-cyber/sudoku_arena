import { createContext, useContext, useState, useCallback } from 'react';

/**
 * ToastContext — lightweight notification system for dashboard pages.
 *
 * Why not a library: the app has no toast dependency yet. The dashboard
 * pages need simple success/error feedback after CRUD operations. A
 * context + a small floating component is simpler than pulling in
 * react-hot-toast or similar for ~10 call sites.
 *
 * Usage:
 *   1. Wrap the app (or dashboard layout) in <ToastProvider>.
 *   2. Call `const { showToast } = useToast()` in any child component.
 *   3. `showToast('Team created', 'success')` — auto-dismisses after 3s.
 *
 * Only one toast is shown at a time. If a second toast arrives while
 * one is visible, it replaces the previous one (no queue — the latest
 * feedback is what matters).
 */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium max-w-sm transition-opacity ${
            toast.type === 'success'
              ? 'bg-green-800 text-green-100 border border-green-600'
              : toast.type === 'error'
              ? 'bg-red-800 text-red-100 border border-red-600'
              : 'bg-gray-700 text-gray-100 border border-gray-600'
          }`}
          role="alert"
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback when used outside a provider — avoids a crash during
    // tests or if a page is rendered standalone.
    return { showToast: () => {} };
  }
  return ctx;
}
