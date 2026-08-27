/**
 * ConfirmDialog — reusable styled replacement for window.confirm().
 *
 * Why this exists: the native browser confirm() shows an OS-level dialog
 * that cannot be styled, cannot show a title, and breaks the visual
 * language of the app. Louise flagged this 2026-08-26 ("make sure all
 * the pop-ups are beautiful").
 *
 * API: parent renders <ConfirmDialog open={bool} title="..." message="..."
 * confirmLabel="..." cancelLabel="..." danger={bool} onConfirm={fn}
 * onCancel={fn} />. The parent owns the open state — this component is
 * purely presentational, so a single component instance can serve
 * several confirmations by swapping the props.
 *
 * The dialog does NOT close itself: the parent's onConfirm/onCancel
 * handlers must flip the open state. This avoids a race where the dialog
 * vanishes before the async delete call fires (the user clicks twice).
 *
 * Styling mirrors the existing credentials dialog (CompetitionDetailPage
 * ~line 826): black/50 backdrop, white rounded card, indigo or red
 * confirm button depending on `danger`.
 */
export default function ConfirmDialog({
  open = false,
  title = '',
  message = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm = () => {},
  onCancel = () => {},
}) {
  if (!open) return null;

  const confirmClass = danger
    ? 'bg-red-600 hover:bg-red-500 text-white'
    : 'bg-indigo-600 hover:bg-indigo-500 text-white';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        {title && (
          <h3 id="confirm-dialog-title" className="text-lg font-semibold mb-2">
            {title}
          </h3>
        )}
        {message && (
          <p className="text-xs sm:text-sm text-gray-600 whitespace-pre-line">
            {message}
          </p>
        )}
        <div className="flex gap-2 mt-6 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 sm:flex-initial px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded text-sm ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
