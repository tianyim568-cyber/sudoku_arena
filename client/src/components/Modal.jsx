/**
 * Modal — light-themed overlay for dashboard pages.
 *
 * ConfirmDialog (the white-background one) is used on public-facing pages.
 * Dashboard pages now use a light theme (bg-gray-50 base, white cards), so
 * this modal matches with a white background and dark text.
 *
 * API: <Modal onClose={fn} title="...">{children}</Modal>
 * The parent owns the open/close state (same pattern as ConfirmDialog).
 * Clicking the backdrop calls onClose — standard escape hatch.
 */
export default function Modal({ onClose, title, children }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-200">
        {title && (
          <h3 id="modal-title" className="text-lg font-semibold text-gray-900 mb-4">
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}
