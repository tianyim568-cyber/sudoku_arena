import { useState, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';
import Modal from '../components/Modal';
import { useToast } from '../components/ToastContext';

// Dashboard "Teams" page — CRUD for teams and their members within a
// selected competition. Uses the light dashboard theme (bg-gray-50 base,
// bg-white cards, dark text) to match DashboardCompetitionsPage and the
// surrounding layout.
//
// Data flow:
//   api.listCompetitions()          → competition picker
//   api.listTeams(competitionId)    → team cards with members
//   api.listAllParticipants({competitionId}) → available participants
//   api.createTeam / addTeamMember / removeTeamMember → mutations
//
// The team_members table has no "position" column, so the add-member modal
// only asks for a participant — no role/position selector.

export default function DashboardTeamsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [competitions, setCompetitions] = useState([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState('');
  const [teams, setTeams] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create team modal
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creating, setCreating] = useState(false);

  // Add member modal
  const [addMemberForTeam, setAddMemberForTeam] = useState(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  // Load competitions on mount
  useEffect(() => {
    loadCompetitions();
  }, []);

  // Load teams and participants when competition changes
  useEffect(() => {
    if (selectedCompetitionId) {
      loadTeams();
      loadParticipants();
    }
  }, [selectedCompetitionId]);

  const loadCompetitions = async () => {
    try {
      const res = await api.listCompetitions();
      if (res.code === 200) {
        setCompetitions(res.data || []);
      }
    } catch (err) {
      showToast(t('teams.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadTeams = async () => {
    try {
      const res = await api.listTeams(selectedCompetitionId);
      if (res.code === 200) {
        setTeams(res.data || []);
      }
    } catch (err) {
      showToast(t('teams.loadFailed'), 'error');
    }
  };

  const loadParticipants = async () => {
    try {
      const res = await api.listAllParticipants({ competitionId: selectedCompetitionId });
      if (res.code === 200) {
        setParticipants(res.data || []);
      }
    } catch (err) {
      console.error('Failed to load participants:', err);
    }
  };

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;

    setCreating(true);
    try {
      const res = await api.createTeam(selectedCompetitionId, newTeamName.trim());
      if (res.code === 200) {
        showToast(t('teams.createSuccess'), 'success');
        setShowCreateTeam(false);
        setNewTeamName('');
        loadTeams();
      } else {
        showToast(res.message || t('teams.createFailed'), 'error');
      }
    } catch (err) {
      showToast(t('teams.createFailed'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedParticipantId) return;

    setAddingMember(true);
    try {
      const res = await api.addTeamMember(addMemberForTeam.id, selectedParticipantId);
      if (res.code === 200) {
        showToast(t('teams.addMemberSuccess'), 'success');
        setAddMemberForTeam(null);
        setSelectedParticipantId('');
        loadTeams();
      } else {
        showToast(res.message || t('teams.addMemberFailed'), 'error');
      }
    } catch (err) {
      showToast(t('teams.addMemberFailed'), 'error');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (teamId, participantId) => {
    if (!confirm(t('teams.removeMemberConfirm'))) return;

    try {
      const res = await api.removeTeamMember(teamId, participantId);
      if (res.code === 200) {
        showToast(t('teams.removeMemberSuccess'), 'success');
        loadTeams();
      } else {
        showToast(res.message || t('teams.removeMemberFailed'), 'error');
      }
    } catch (err) {
      showToast(t('teams.removeMemberFailed'), 'error');
    }
  };

  // Get available participants (not already in this team)
  const getAvailableParticipants = (team) => {
    const memberIds = new Set((team.members || []).map(m => m.participant_id));
    return participants.filter(p => !memberIds.has(p.id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('teams.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('teams.subtitle')}</p>
      </div>

      {/* Competition selector */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('teams.selectCompetition')}
        </label>
        <select
          value={selectedCompetitionId}
          onChange={(e) => setSelectedCompetitionId(e.target.value)}
          className="w-full bg-white text-gray-900 rounded-lg px-3 py-2 border border-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">{t('teams.selectCompetitionPlaceholder')}</option>
          {competitions.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Teams section */}
      {selectedCompetitionId && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('teams.teamsList')} ({teams.length})
            </h2>
            <button
              onClick={() => setShowCreateTeam(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-medium transition-colors"
            >
              {t('teams.createTeam')}
            </button>
          </div>

          {teams.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              {t('teams.noTeams')}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {teams.map(team => (
                <div key={team.id} className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">{team.name}</h3>

                  {/* Members list */}
                  <div className="space-y-2 mb-4">
                    {(team.members || []).length === 0 ? (
                      <p className="text-sm text-gray-400 italic">{t('teams.noMembers')}</p>
                    ) : (
                      team.members.map(member => (
                        <div key={member.participant_id} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
                          <div className="flex-1">
                            <div className="text-sm text-gray-800 font-medium">{member.display_name}</div>
                            <div className="text-xs text-gray-500">
                              {member.school || ''}
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveMember(team.id, member.participant_id)}
                            className="text-red-500 hover:text-red-600 text-xs font-medium transition-colors"
                          >
                            {t('teams.removeMember')}
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add member button */}
                  <button
                    onClick={() => setAddMemberForTeam(team)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-sm text-gray-700 font-medium transition-colors"
                  >
                    {t('teams.addMember')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!selectedCompetitionId && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-400">
          {t('teams.selectCompetitionFirst')}
        </div>
      )}

      {/* Create team modal */}
      {showCreateTeam && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateTeam(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('teams.createTeamTitle')}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('teams.teamNameLabel')}
                </label>
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder={t('teams.teamNamePlaceholder')}
                  className="w-full bg-white text-gray-900 rounded-lg px-3 py-2 border border-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowCreateTeam(false)}
                  className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-sm text-gray-700 font-medium transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreateTeam}
                  disabled={!newTeamName.trim() || creating}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors"
                >
                  {creating ? t('common.loading') : t('teams.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add member modal */}
      {addMemberForTeam && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setAddMemberForTeam(null); }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('teams.addMemberTitle')}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('teams.selectParticipant')}
                </label>
                <select
                  value={selectedParticipantId}
                  onChange={(e) => setSelectedParticipantId(e.target.value)}
                  className="w-full bg-white text-gray-900 rounded-lg px-3 py-2 border border-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t('teams.selectParticipantPlaceholder')}</option>
                  {getAvailableParticipants(addMemberForTeam).map(p => (
                    <option key={p.id} value={p.id}>{p.name} - {p.school}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setAddMemberForTeam(null)}
                  className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-sm text-gray-700 font-medium transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleAddMember}
                  disabled={!selectedParticipantId || addingMember}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors"
                >
                  {addingMember ? t('common.loading') : t('teams.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
