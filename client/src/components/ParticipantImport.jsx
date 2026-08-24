import { useState, useRef } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

export default function ParticipantImport({ competitionId, onImportComplete }) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState('upload'); // upload | preview | importing | done
  const [previewData, setPreviewData] = useState(null); // { valid: [], invalid: [], total }
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setPhase('uploading');

    try {
      const res = await api.uploadParticipants(competitionId, file);
      if (res.code === 200) {
        setPreviewData(res.data); // { valid: [...], invalid: [...], total }
        setPhase('preview');
      } else {
        setError(res.message || 'Upload failed');
        setPhase('upload');
      }
    } catch (err) {
      setError(err.message || 'Upload failed');
      setPhase('upload');
    }
  };

  const handleConfirm = async () => {
    if (!previewData?.valid?.length) return;

    setPhase('importing');
    setError(null);

    try {
      const res = await api.confirmParticipants(competitionId, previewData.valid);
      if (res.code === 200) {
        setResult(res.data);
        setPhase('done');
        if (onImportComplete) onImportComplete();

        // Auto-dismiss success message after 4 seconds
        setTimeout(() => {
          setPhase('upload');
          setResult(null);
          setPreviewData(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }, 4000);
      } else {
        // Show transaction failure message
        const failMsg = res.message || t('competitionDetail.importAllFailed');
        setError(failMsg);
        setPhase('preview');

        // Auto-dismiss error after 4 seconds
        setTimeout(() => setError(null), 4000);
      }
    } catch {
      const failMsg = t('competitionDetail.importAllFailed');
      setError(failMsg);
      setPhase('preview');

      // Auto-dismiss error after 4 seconds
      setTimeout(() => setError(null), 4000);
    }
  };

  const handleCancel = () => {
    setPhase('upload');
    setPreviewData(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDone = () => {
    setResult(null);
    setPhase('upload');
    setPreviewData(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Merge valid + invalid rows for display, with a _valid flag
  const allRows = previewData
    ? [
        ...previewData.valid.map((r) => ({ ...r, _valid: true })),
        ...previewData.invalid.map((r) => ({ ...r, _valid: false })),
      ]
    : [];

  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6 space-y-4">
      <h3 className="text-base sm:text-lg font-semibold text-gray-800">
        {t('competitionDetail.participantImport')}
      </h3>

      {/* Upload Phase */}
      {phase === 'upload' && (
        <div className="space-y-3">
          <p className="text-xs sm:text-sm text-gray-600">
            {t('competitionDetail.participantImportDesc')}
          </p>
          <div className="flex items-center gap-2 sm:gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleUpload}
              className="block w-full text-xs sm:text-sm text-gray-500 file:mr-2 sm:file:mr-4 file:py-1.5 sm:file:py-2 file:px-3 sm:file:px-4 file:rounded-md file:border-0 file:text-xs sm:file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
          {error && (
            <div className="p-2 sm:p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs sm:text-sm">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Uploading Phase */}
      {phase === 'uploading' && (
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-6 w-6 sm:h-8 sm:w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-xs sm:text-sm text-gray-600">{t('competitionDetail.uploading')}</p>
        </div>
      )}

      {/* Preview Phase */}
      {phase === 'preview' && previewData && (
        <div className="space-y-3 sm:space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-2 sm:p-3">
            <p className="text-xs sm:text-sm text-blue-800">
              <strong>{t('competitionDetail.validRows')}:</strong> {previewData.valid.length}
            </p>
            {previewData.invalid.length > 0 && (
              <p className="text-xs sm:text-sm text-orange-700 mt-1">
                <strong>{t('competitionDetail.invalidRows')}:</strong> {previewData.invalid.length}
              </p>
            )}
          </div>

          {/* Preview Table */}
          <div className="max-h-64 sm:max-h-96 overflow-auto border border-gray-200 rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-1 sm:px-2 py-1 text-left">#</th>
                  <th className="px-1 sm:px-2 py-1 text-left hidden sm:table-cell">{t('competitionDetail.province')}</th>
                  <th className="px-1 sm:px-2 py-1 text-left hidden md:table-cell">{t('competitionDetail.city')}</th>
                  <th className="px-1 sm:px-2 py-1 text-left hidden md:table-cell">{t('competitionDetail.district')}</th>
                  <th className="px-1 sm:px-2 py-1 text-left">{t('competitionDetail.school')}</th>
                  <th className="px-1 sm:px-2 py-1 text-left">{t('competitionDetail.studentName')}</th>
                  <th className="px-1 sm:px-2 py-1 text-left hidden sm:table-cell">{t('competitionDetail.age')}</th>
                  <th className="px-1 sm:px-2 py-1 text-left hidden lg:table-cell">{t('competitionDetail.category')}</th>
                  <th className="px-1 sm:px-2 py-1 text-left">{t('competitionDetail.teamName')}</th>
                  <th className="px-1 sm:px-2 py-1 text-left">{t('competitionDetail.validRows').split(':')[0]}</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={row._valid ? 'bg-green-50' : 'bg-red-50'}
                  >
                    <td className="px-1 sm:px-2 py-1">{idx + 1}</td>
                    <td className="px-1 sm:px-2 py-1 hidden sm:table-cell">{row.province || '-'}</td>
                    <td className="px-1 sm:px-2 py-1 hidden md:table-cell">{row.city || '-'}</td>
                    <td className="px-1 sm:px-2 py-1 hidden md:table-cell">{row.district || '-'}</td>
                    <td className="px-1 sm:px-2 py-1">{row.school}</td>
                    <td className="px-1 sm:px-2 py-1">{row.name}</td>
                    <td className="px-1 sm:px-2 py-1 hidden sm:table-cell">{row.age || '-'}</td>
                    <td className="px-1 sm:px-2 py-1 hidden lg:table-cell">{row.category || '-'}</td>
                    <td className="px-1 sm:px-2 py-1">{row.teamName || '-'}</td>
                    <td className="px-1 sm:px-2 py-1">
                      {row._valid ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-red-600 text-xs">{row._error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <div className="p-2 sm:p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs sm:text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={handleConfirm}
              disabled={previewData.valid.length === 0}
              className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs sm:text-sm"
            >
              {t('competitionDetail.confirmImport')}
            </button>
            <button
              onClick={handleCancel}
              className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-xs sm:text-sm"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Importing Phase */}
      {phase === 'importing' && (
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-6 w-6 sm:h-8 sm:w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-xs sm:text-sm text-gray-600">{t('competitionDetail.importing')}</p>
        </div>
      )}

      {/* Done Phase */}
      {phase === 'done' && result && (
        <div className="space-y-3">
          <div className="bg-green-50 border border-green-200 rounded p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-green-800 mb-2">
              <strong>{t('competitionDetail.importSuccess')}</strong>
            </p>
            <p className="text-xs sm:text-sm text-green-700">
              {t('competitionDetail.importedCount')}: {result.imported}
            </p>
            <p className="text-xs text-gray-500 mt-2 italic">
              Auto-closing in a few seconds...
            </p>
          </div>

          <button
            onClick={handleDone}
            className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs sm:text-sm"
          >
            {t('common.done')}
          </button>
        </div>
      )}
    </div>
  );
}
