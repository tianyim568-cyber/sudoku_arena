/**
 * Modal — dark-themed overlay for dashboard pages.
 *
 * ConfirmDialog (the white-background one) is used on public-facing pages.
 * Dashboard pages use a dark theme (bg-gray-800), so a separate modal with
 * matching colours avoids a jarring white popup in the middle of a dark UI.
 *
 * API: <Modal onClose={fn} title="...">{children}</Modal>
 * The parent owns the open/close state (same pattern as ConfirmDialog).
 * Clicking the backdrop calls onClose — standard escape hatch.
 */
export default function Modal({ onClose, title, children }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-700">
        {title && (
          <h3 id="modal-title" className="text-lg font-semibold text-gray-100 mb-4">
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}
