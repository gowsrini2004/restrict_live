import React, { useState, useEffect, useMemo } from 'react';
import { apiClient, streamApiClient, parseErrorMessage } from '../services/apiClient';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  Users,
  Video,
  Upload,
  KeyRound,
  RefreshCw,
  MessageSquare,
  Trash2,
  Check,
  FileText,
  Play,
  Square,
  ImageIcon,
  UserPlus,
  ShieldCheck,
  UserX,
  UserCheck,
  Crown,
  Search,
  User,
  Shield,
  Clock,
  AlertTriangle
} from 'lucide-react';

interface LiveUserMetric {
  user_id: string;
  email: string;
  last_active_seconds_ago: number;
}

interface UserRosterItem {
  id: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  is_super_admin: boolean;
  created_at: string;
  last_login_at?: string;
}

interface Question {
  id: string;
  user_email: string;
  question_text: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ANSWERED';
  upvotes: number;
  created_at: string;
}

export const AdminDashboardPage: React.FC = () => {
  const { isSuperAdmin, user: currentUser } = useAuth();
  const { showSuccess, showError, showWarning } = useToast();

  const [activeTab, setActiveTab] = useState<'metrics' | 'users' | 'stream' | 'qna'>('metrics');

  // Live Metrics state
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [activeUsers, setActiveUsers] = useState<LiveUserMetric[]>([]);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState<boolean>(false);

  // Stream config state
  const [youtubeUrl, setYoutubeUrl] = useState<string>('https://www.youtube.com/watch?v=jfKfPfyJRdk');
  const [streamTitle, setStreamTitle] = useState<string>('International Retreat Live Stream');
  const [isStreamLive, setIsStreamLive] = useState<boolean>(true);
  const [isPlaybackMode, setIsPlaybackMode] = useState<boolean>(false);
  const [offlineImageUrl, setOfflineImageUrl] = useState<string>('https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80');
  const [offlineMessage, setOfflineMessage] = useState<string>('The live broadcast is currently offline. Please stay tuned for the next session.');
  const [isTogglingLive, setIsTogglingLive] = useState<boolean>(false);
  const [isTogglingPlayback, setIsTogglingPlayback] = useState<boolean>(false);

  // Emergency Fallback state — "break glass" switch: bypasses login/Q&A/
  // tab-lock/protected player for every visitor, showing a bare loginless
  // YouTube embed instead. Enabling it is confirmed via a modal since the
  // blast radius is total; disabling it isn't (it's the "fix" action).
  const [isEmergencyFallback, setIsEmergencyFallback] = useState<boolean>(false);
  const [isTogglingFallback, setIsTogglingFallback] = useState<boolean>(false);
  const [showFallbackConfirm, setShowFallbackConfirm] = useState<boolean>(false);

  // User Management state
  const [rosterUsers, setRosterUsers] = useState<UserRosterItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'attendee'>('all');

  // Single User Create Form state
  const [newEmail, setNewEmail] = useState<string>('');
  const [newRole, setNewRole] = useState<'attendee' | 'admin'>('attendee');
  const [isCreatingUser, setIsCreatingUser] = useState<boolean>(false);

  // Bulk import state
  const [rawEmails, setRawEmails] = useState<string>('');
  const [importResult, setImportResult] = useState<{
    created_count: number;
    existing_count: number;
    invalid_entries: string[];
  } | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);

  // Delete Modal state
  const [deleteModalUser, setDeleteModalUser] = useState<{ id: string; email: string } | null>(null);

  // Event Passcode state — Super Admin only (backend now rejects this
  // entire endpoint for regular Admins, not just the admin_passcode field).
  const [attendeePasscode, setAttendeePasscode] = useState<string>('IRK2026');
  const [adminPasscode, setAdminPasscode] = useState<string>('183663');
  const [superAdminPasscode, setSuperAdminPasscode] = useState<string>('Mother108*');

  // Q&A Moderation list
  const [adminQuestions, setAdminQuestions] = useState<Question[]>([]);

  // Fetch Live Metrics
  const fetchMetrics = async () => {
    try {
      setIsLoadingMetrics(true);
      const res = await apiClient.get('/admin/metrics/live-viewers/');
      if (res.data?.success && res.data.data) {
        setOnlineCount(res.data.data.online_count || 0);
        setActiveUsers(res.data.data.active_users || []);
      }
    } catch (err) {
      console.error("Failed to fetch live metrics:", err);
    } finally {
      setIsLoadingMetrics(false);
    }
  };

  // Fetch Stream Config
  const fetchStreamConfig = async () => {
    try {
      const res = await streamApiClient.get('/stream/config/');
      if (res.data?.success && res.data.data) {
        setYoutubeUrl(res.data.data.youtube_url || '');
        setStreamTitle(res.data.data.title || '');
        setIsStreamLive(res.data.data.is_live);
        setIsPlaybackMode(!!res.data.data.is_playback_mode);
        setIsEmergencyFallback(!!res.data.data.is_emergency_fallback);
        if (res.data.data.offline_image_url) setOfflineImageUrl(res.data.data.offline_image_url);
        if (res.data.data.offline_message) setOfflineMessage(res.data.data.offline_message);
      }
    } catch (err) {
      console.error("Failed to fetch stream config:", err);
    }
  };

  // Fetch User Roster
  const fetchRoster = async () => {
    try {
      const res = await apiClient.get('/admin/users/');
      if (res.data?.success && res.data.data) {
        setRosterUsers(res.data.data.users || []);
      }
    } catch (err) {
      console.error("Failed to fetch user roster:", err);
    }
  };

  // Fetch Passcodes — Super Admin only; regular Admins can't reach this
  // endpoint at all now, so don't even bother calling it for them.
  const fetchPasscode = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await apiClient.get('/admin/config/passcode/');
      if (res.data?.success && res.data.data) {
        setAttendeePasscode(res.data.data.common_passcode || 'IRK2026');
        if (res.data.data.admin_passcode) setAdminPasscode(res.data.data.admin_passcode);
        if (res.data.data.super_admin_passcode) setSuperAdminPasscode(res.data.data.super_admin_passcode);
      }
    } catch (err) {
      console.error("Failed to fetch passcode:", err);
    }
  };

  // Fetch Admin Questions
  const fetchAdminQuestions = async () => {
    try {
      const res = await streamApiClient.get('/admin/questions/');
      if (res.data?.success && res.data.data) {
        setAdminQuestions(res.data.data.questions || []);
      }
    } catch (err) {
      console.error("Failed to fetch admin questions:", err);
    }
  };

  useEffect(() => {
    fetchMetrics();
    fetchStreamConfig();
    fetchRoster();
    fetchPasscode();
    fetchAdminQuestions();

    const metricsInterval = setInterval(fetchMetrics, 5000);
    const qnaInterval = setInterval(fetchAdminQuestions, 8000);
    return () => {
      clearInterval(metricsInterval);
      clearInterval(qnaInterval);
    };
  }, []);

  // Filtered & Sorted User Roster (Super Admins -> Admins -> Attendees)
  const filteredUsers = useMemo(() => {
    return rosterUsers
      .filter((u) => {
        // Search Filter
        if (searchQuery && !u.email.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
        // Status Filter
        if (statusFilter === 'active' && !u.is_active) return false;
        if (statusFilter === 'disabled' && u.is_active) return false;
        // Role Filter
        if (roleFilter === 'admin' && !u.is_admin) return false;
        if (roleFilter === 'attendee' && u.is_admin) return false;
        return true;
      })
      .sort((a, b) => {
        // Priority 1: Super Admin first
        if (a.is_super_admin && !b.is_super_admin) return -1;
        if (!a.is_super_admin && b.is_super_admin) return 1;
        // Priority 2: Admins before Attendees
        if (a.is_admin && !b.is_admin) return -1;
        if (!a.is_admin && b.is_admin) return 1;
        // Priority 3: Alphabetical by email
        return a.email.localeCompare(b.email);
      });
  }, [rosterUsers, searchQuery, statusFilter, roleFilter]);

  // User Counts Breakdown
  const userCounts = useMemo(() => {
    const superAdminCount = rosterUsers.filter((u) => u.is_super_admin).length;
    const adminCount = rosterUsers.filter((u) => u.is_admin && !u.is_super_admin).length;
    const attendeeCount = rosterUsers.filter((u) => !u.is_admin).length;
    const activeCount = rosterUsers.filter((u) => u.is_active).length;
    const disabledCount = rosterUsers.filter((u) => !u.is_active).length;

    return {
      total: rosterUsers.length,
      superAdminCount,
      adminCount,
      attendeeCount,
      activeCount,
      disabledCount,
    };
  }, [rosterUsers]);

  // Update Stream Config Submit
  const handleUpdateStream = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await streamApiClient.post('/admin/stream/config/', {
        youtube_url: youtubeUrl,
        title: streamTitle,
        is_live: isStreamLive,
        offline_image_url: offlineImageUrl,
        offline_message: offlineMessage,
      });
      if (res.data?.success) {
        showSuccess("Stream Updated", "Live stream settings and offline banner saved.");
      }
    } catch (err) {
      showError("Update Failed", parseErrorMessage(err));
    }
  };

  // One-Click Start / Stop Stream Toggle
  const handleToggleLiveStatus = async (targetState?: boolean) => {
    try {
      setIsTogglingLive(true);
      const res = await streamApiClient.post('/admin/stream/toggle-live/', {
        is_live: targetState !== undefined ? targetState : !isStreamLive,
      });
      if (res.data?.success) {
        setIsStreamLive(res.data.data.is_live);
        if (res.data.data.is_live) {
          showSuccess("Broadcasting Live", "The stream is now LIVE for all attendees.");
        } else {
          showWarning("Stream Offline", "The stream has stopped. Attendees now see the offline banner.");
        }
      }
    } catch (err) {
      showError("Stream Action Failed", parseErrorMessage(err));
    } finally {
      setIsTogglingLive(false);
    }
  };

  // One-Click Enable / Disable Playback Mode — intended for once a
  // broadcast has ended, letting viewers log in and watch the recording
  // back through the same protected player (labeled "Playback", not "Live").
  const handleTogglePlaybackMode = async (targetState?: boolean) => {
    const nextValue = targetState !== undefined ? targetState : !isPlaybackMode;
    if (nextValue && isStreamLive) {
      showError("Stream Is Live", "Playback Mode can only be enabled while the live stream is stopped.");
      return;
    }
    try {
      setIsTogglingPlayback(true);
      const res = await streamApiClient.post('/admin/stream/toggle-playback/', {
        is_playback_mode: targetState !== undefined ? targetState : !isPlaybackMode,
      });
      if (res.data?.success) {
        setIsPlaybackMode(res.data.data.is_playback_mode);
        if (res.data.data.is_playback_mode) {
          showSuccess("Playback Mode Enabled", "Attendees can now log in and watch the recording back.");
        } else {
          showWarning("Playback Mode Disabled", "The recording is no longer available for playback.");
        }
      }
    } catch (err) {
      showError("Playback Mode Action Failed", parseErrorMessage(err));
    } finally {
      setIsTogglingPlayback(false);
    }
  };

  // "Break glass" toggle — bypasses login/Q&A/tab-lock/protected player for
  // every visitor. Enabling always comes through the confirm modal (see the
  // button's onClick), so this itself just performs whatever was confirmed.
  const handleToggleEmergencyFallback = async (targetState: boolean) => {
    try {
      setIsTogglingFallback(true);
      const res = await streamApiClient.post('/admin/stream/toggle-fallback/', {
        is_emergency_fallback: targetState,
      });
      if (res.data?.success) {
        setIsEmergencyFallback(res.data.data.is_emergency_fallback);
        if (res.data.data.is_emergency_fallback) {
          showWarning("Emergency Fallback Enabled", "Every visitor now sees a bare video embed — no login, Q&A, or protections.");
        } else {
          showSuccess("Emergency Fallback Disabled", "The normal app is restored for all visitors.");
        }
      }
    } catch (err) {
      showError("Emergency Fallback Action Failed", parseErrorMessage(err));
    } finally {
      setIsTogglingFallback(false);
      setShowFallbackConfirm(false);
    }
  };

  // Create Single User (Attendee or Admin)
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail) return;

    if (newRole === 'admin' && !isSuperAdmin) {
      showError("Permission Denied", "Only the Super Administrator (events@chennaimath.org) can register new Administrators.");
      return;
    }

    try {
      setIsCreatingUser(true);
      const res = await apiClient.post('/admin/users/create/', {
        email: cleanEmail,
        role: newRole,
      });
      if (res.data?.success) {
        showSuccess("User Registered", `${cleanEmail} registered as ${newRole.toUpperCase()}!`);
        setNewEmail('');
        fetchRoster();
      }
    } catch (err) {
      showError("Registration Failed", parseErrorMessage(err));
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Enable / Disable User Toggle
  const handleToggleUserStatus = async (userId: string, email: string, isCurrentlyActive: boolean, isTargetAdmin: boolean) => {
    if (isTargetAdmin && !isSuperAdmin) {
      showError("Permission Denied", "Only the Super Administrator can enable or disable Administrator accounts.");
      return;
    }

    try {
      const res = await apiClient.patch(`/admin/users/${userId}/toggle-status/`);
      if (res.data?.success) {
        if (isCurrentlyActive) {
          showWarning("User Disabled", `${email} has been disabled and their active session evicted.`);
        } else {
          showSuccess("User Enabled", `${email} access has been enabled.`);
        }
        fetchRoster();
      }
    } catch (err) {
      showError("Status Action Failed", parseErrorMessage(err));
    }
  };

  // Confirm Delete User
  const handleConfirmDeleteUser = async () => {
    if (!deleteModalUser) return;
    try {
      const res = await apiClient.delete(`/admin/users/${deleteModalUser.id}/`);
      if (res.data?.success) {
        showSuccess("User Deleted", `User ${deleteModalUser.email} was removed from roster.`);
        fetchRoster();
      }
    } catch (err) {
      showError("Delete Failed", parseErrorMessage(err));
    } finally {
      setDeleteModalUser(null);
    }
  };

  // Bulk Import Submit
  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportResult(null);
    if (!rawEmails.trim()) return;

    try {
      setIsImporting(true);
      const res = await apiClient.post('/admin/users/bulk-import/', {
        raw_emails: rawEmails,
      });
      if (res.data?.success) {
        setImportResult(res.data.data);
        showSuccess("Bulk Import Complete", `Added ${res.data.data.created_count} new emails to roster.`);
        setRawEmails('');
        fetchRoster();
      }
    } catch (err) {
      showError("Import Failed", parseErrorMessage(err));
    } finally {
      setIsImporting(false);
    }
  };

  // Passcode Update Submit
  const handlePasscodeUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiClient.post('/admin/config/passcode/', {
        common_passcode: attendeePasscode,
        admin_passcode: adminPasscode,
        super_admin_passcode: superAdminPasscode,
      });
      if (res.data?.success) {
        showSuccess("Passcodes Updated", "System login passcodes updated successfully.");
      }
    } catch (err) {
      showError("Passcode Update Failed", parseErrorMessage(err));
    }
  };

  // Question Moderate
  const handleModerateQuestion = async (id: string, status: 'APPROVED' | 'ANSWERED' | 'REJECTED' | 'DELETE') => {
    try {
      if (status === 'DELETE') {
        await streamApiClient.delete(`/admin/questions/${id}/`);
        showSuccess("Question Deleted", "Question removed from feed.");
      } else {
        await streamApiClient.patch(`/admin/questions/${id}/`, { status });
        showSuccess("Question Moderated", `Question marked as ${status}.`);
      }
      fetchAdminQuestions();
    } catch (err) {
      showError("Moderation Failed", parseErrorMessage(err));
    }
  };

  return (
    <div className="min-h-[calc(100vh-65px)] bg-slate-950 p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Title Bar */}
        <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
              <span>Admin Control Center</span>
              {isSuperAdmin ? (
                <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 font-extrabold flex items-center gap-1 uppercase">
                  <Crown className="w-3.5 h-3.5" /> SUPER ADMIN
                </span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-bold uppercase">
                  ADMINISTRATOR
                </span>
              )}
            </h2>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              Logged in as <strong className="text-white">{currentUser?.email}</strong>
            </p>
          </div>

          {/* Quick Action Cards: Start/Stop Stream & Playback Mode */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* Start / Stop Stream Quick Action Card */}
            <div className="flex items-center gap-4 bg-slate-950/80 px-4 py-3 rounded-2xl border border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <span className={`w-3.5 h-3.5 rounded-full ${isStreamLive ? 'bg-red-500 animate-ping' : 'bg-slate-600'}`} />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {isStreamLive ? 'Broadcasting Live' : 'Stream Offline'}
                </span>
              </div>

              {isStreamLive ? (
                <button
                  onClick={() => handleToggleLiveStatus(false)}
                  disabled={isTogglingLive}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs shadow-lg shadow-red-600/30 transition-all active:scale-95"
                >
                  <Square className="w-4 h-4 fill-current" /> STOP STREAM
                </button>
              ) : (
                <button
                  onClick={() => handleToggleLiveStatus(true)}
                  disabled={isTogglingLive}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs shadow-lg shadow-emerald-500/30 transition-all active:scale-95"
                >
                  <Play className="w-4 h-4 fill-current" /> START STREAM
                </button>
              )}
            </div>

            {/* Playback Mode Quick Action Card — for once a broadcast has
                ended, so attendees can log in and watch the recording back.
                Can only be turned ON while the stream is stopped. */}
            <div className="flex items-center gap-4 bg-slate-950/80 px-4 py-3 rounded-2xl border border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <Clock className={`w-3.5 h-3.5 ${isPlaybackMode ? 'text-amber-400' : 'text-slate-600'}`} />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {isPlaybackMode ? 'Playback Enabled' : 'Playback Disabled'}
                </span>
              </div>

              <button
                onClick={() => handleTogglePlaybackMode(!isPlaybackMode)}
                disabled={isTogglingPlayback || (!isPlaybackMode && isStreamLive)}
                title={!isPlaybackMode && isStreamLive ? 'Stop the live stream first to enable Playback Mode' : undefined}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-extrabold text-xs shadow-lg transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${
                  isPlaybackMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/30'
                }`}
              >
                <Clock className="w-4 h-4" /> {isPlaybackMode ? 'DISABLE PLAYBACK' : 'ENABLE PLAYBACK'}
              </button>
              {!isPlaybackMode && isStreamLive && (
                <span className="text-[10px] text-slate-500 max-w-[120px] leading-snug hidden xl:block">
                  Stop the stream first to enable playback.
                </span>
              )}
            </div>

            {/* Emergency Fallback Quick Action Card — "break glass": bypasses
                login/Q&A/tab-lock/protected player for every visitor. Enabling
                requires confirmation given the blast radius; disabling doesn't. */}
            <div className={`flex items-center gap-4 px-4 py-3 rounded-2xl border shrink-0 ${
              isEmergencyFallback ? 'bg-red-950/40 border-red-500/40' : 'bg-slate-950/80 border-white/10'
            }`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className={`w-3.5 h-3.5 ${isEmergencyFallback ? 'text-red-400 animate-pulse' : 'text-slate-600'}`} />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {isEmergencyFallback ? 'Fallback Active' : 'Fallback Off'}
                </span>
              </div>

              {isEmergencyFallback ? (
                <button
                  onClick={() => handleToggleEmergencyFallback(false)}
                  disabled={isTogglingFallback}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs shadow-lg shadow-red-600/30 transition-all active:scale-95"
                >
                  <AlertTriangle className="w-4 h-4" /> DISABLE FALLBACK
                </button>
              ) : (
                <button
                  onClick={() => setShowFallbackConfirm(true)}
                  disabled={isTogglingFallback}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-red-950 text-red-400 hover:text-red-300 font-extrabold text-xs border border-red-500/30 transition-all active:scale-95"
                >
                  <AlertTriangle className="w-4 h-4" /> EMERGENCY FALLBACK
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Persistent warning banner — easy to miss a card in a header row,
            impossible to miss this, for something with this much blast radius. */}
        {isEmergencyFallback && (
          <div className="bg-red-950/60 border border-red-500/40 rounded-2xl px-4 py-3 flex items-center gap-3 animate-fadeIn">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 animate-pulse" />
            <p className="text-sm text-red-200 flex-1">
              <strong className="font-bold">Emergency Fallback is ACTIVE.</strong> Every visitor is seeing a bare video embed with no login, Q&amp;A, or protections. Disable it as soon as the normal app is working again.
            </p>
            <button
              onClick={() => handleToggleEmergencyFallback(false)}
              disabled={isTogglingFallback}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs shadow-lg shadow-red-600/30 transition-all active:scale-95 shrink-0"
            >
              Disable Now
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('metrics')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all shrink-0 ${
              activeTab === 'metrics'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" /> Live Telemetry ({onlineCount} Viewers)
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all shrink-0 ${
              activeTab === 'users'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <UserPlus className="w-4 h-4" /> User Management ({userCounts.total})
          </button>

          <button
            onClick={() => setActiveTab('stream')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all shrink-0 ${
              activeTab === 'stream'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Video className="w-4 h-4" /> Stream & Offline Banner
          </button>

          <button
            onClick={() => setActiveTab('qna')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all shrink-0 ${
              activeTab === 'qna'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <MessageSquare className="w-4 h-4" /> Q&A Moderation ({adminQuestions.length})
          </button>
        </div>

        {/* TAB 1: Live Metrics */}
        {activeTab === 'metrics' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-400" />
                  <h3 className="text-white font-bold text-base">Active Online Viewers ({onlineCount})</h3>
                </div>
                <button
                  onClick={fetchMetrics}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMetrics ? 'animate-spin text-amber-400' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {activeUsers.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-sm">
                  No active viewer heartbeats received in the last 45 seconds.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-white/10">
                      <tr>
                        <th className="p-3">User Email</th>
                        <th className="p-3">User ID</th>
                        <th className="p-3">Last Heartbeat</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {activeUsers.map((u) => (
                        <tr key={u.user_id} className="hover:bg-slate-950/40">
                          <td className="p-3 font-medium text-white">{u.email}</td>
                          <td className="p-3 font-mono text-slate-400">{u.user_id}</td>
                          <td className="p-3 text-slate-300">{u.last_active_seconds_ago}s ago</td>
                          <td className="p-3">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              ONLINE ACTIVE
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: User Management (Counter Cards, Search, Filters, Admins First, Permission Restrictions) */}
        {activeTab === 'users' && (
          <div className="space-y-6 animate-fadeIn">
            {/* User Breakdown Counter Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-2xl font-black text-white">{userCounts.total}</span>
                  <span className="text-xs text-slate-400 block leading-tight">Total Users</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-2xl font-black text-amber-400">{userCounts.superAdminCount}</span>
                  <span className="text-xs text-slate-400 block leading-tight">Super Admin</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-2xl font-black text-blue-400">{userCounts.adminCount}</span>
                  <span className="text-xs text-slate-400 block leading-tight">Administrators</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-2xl font-black text-slate-200">{userCounts.attendeeCount}</span>
                  <span className="text-xs text-slate-400 block leading-tight">Attendees</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Registration Form & Bulk Import */}
              <div className="lg:col-span-1 bg-slate-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
                <h3 className="text-white font-bold text-base flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-amber-400" /> Register User / Admin
                </h3>

                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email Address</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="user@example.com"
                      required
                      className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Role Authorization</label>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as 'attendee' | 'admin')}
                      className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                    >
                      <option value="attendee">Attendee (Live Stream Viewer)</option>
                      {isSuperAdmin ? (
                        <option value="admin">Administrator (Full Admin Access)</option>
                      ) : (
                        <option value="admin" disabled>
                          Administrator (Super Admin Only)
                        </option>
                      )}
                    </select>
                    {!isSuperAdmin && (
                      <p className="text-[11px] text-amber-400/80 mt-1">
                        Only Super Admin (events@chennaimath.org) can register new Administrators.
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isCreatingUser || !newEmail.trim()}
                    className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
                  >
                    {isCreatingUser ? 'Registering...' : 'Add User to Roster'}
                  </button>
                </form>

                {/* Bulk Import Section */}
                <div className="pt-4 border-t border-white/10 space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Upload className="w-4 h-4 text-amber-400" /> Bulk CSV Email Import
                  </h4>
                  <textarea
                    value={rawEmails}
                    onChange={(e) => setRawEmails(e.target.value)}
                    rows={5}
                    placeholder={`attendee1@example.com\nattendee2@example.com`}
                    className="w-full p-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-amber-500 resize-none"
                  />
                  <button
                    onClick={handleBulkImport}
                    disabled={isImporting || !rawEmails.trim()}
                    className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-white/10 transition-all disabled:opacity-50"
                  >
                    {isImporting ? 'Importing...' : 'Import Bulk List'}
                  </button>

                  {importResult && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs space-y-1">
                      <p className="font-bold text-amber-400">Import Summary:</p>
                      <p className="text-slate-300">Added: <span className="font-bold text-emerald-400">{importResult.created_count}</span> | Already Existing: <span className="font-bold text-slate-400">{importResult.existing_count}</span></p>
                      {importResult.invalid_entries?.length > 0 && (
                        <p className="text-rose-400 text-[11px]">Invalid: {importResult.invalid_entries.join(', ')}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Roster & User Management Table with Search & Status Dropdown */}
              <div className="lg:col-span-2 bg-slate-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                  <h3 className="text-white font-bold text-base flex items-center gap-2">
                    <FileText className="w-5 h-5 text-amber-400" /> User Roster ({filteredUsers.length})
                  </h3>

                  {/* Search Input & Status Dropdown Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Real-time Email Search */}
                    <div className="relative min-w-[180px]">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search email..."
                        className="w-full pl-9 pr-3 py-1.5 bg-slate-950/80 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Status Dropdown Filter */}
                    <div className="relative">
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                        className="pl-3 pr-8 py-1.5 bg-slate-950/80 border border-white/10 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-amber-500 cursor-pointer"
                      >
                        <option value="all">All Statuses</option>
                        <option value="active">Active Only</option>
                        <option value="disabled">Disabled Only</option>
                      </select>
                    </div>

                    {/* Role Filter Dropdown */}
                    <div className="relative">
                      <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value as any)}
                        className="pl-3 pr-8 py-1.5 bg-slate-950/80 border border-white/10 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-amber-500 cursor-pointer"
                      >
                        <option value="all">All Roles</option>
                        <option value="admin">Admins First</option>
                        <option value="attendee">Attendees Only</option>
                      </select>
                    </div>

                    <button
                      onClick={fetchRoster}
                      className="p-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
                      title="Refresh List"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* User Table (Admins first) */}
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-white/10 sticky top-0">
                      <tr>
                        <th className="p-3">User Email</th>
                        <th className="p-3">Role</th>
                        <th className="p-3">Account Status</th>
                        <th className="p-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-slate-500">
                            No users match the search criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u) => {
                          // Permission Rules:
                          // 1. Super Admin row cannot be modified/disabled by anyone.
                          // 2. Regular Admin rows can ONLY be disabled by Super Admin (`isSuperAdmin`).
                          // 3. Regular Admins CAN disable regular Attendees.
                          const isTargetAdmin = u.is_admin || u.is_super_admin;
                          const canToggleStatus = !u.is_super_admin && (isSuperAdmin || !isTargetAdmin);
                          const canDelete = isSuperAdmin && !u.is_super_admin;

                          return (
                            <tr key={u.id} className="hover:bg-slate-950/40">
                              <td className="p-3 font-medium text-white">{u.email}</td>
                              <td className="p-3">
                                {u.is_super_admin ? (
                                  <span className="text-amber-400 font-extrabold flex items-center gap-1">
                                    <Crown className="w-3.5 h-3.5" /> Super Admin
                                  </span>
                                ) : u.is_admin ? (
                                  <span className="text-blue-400 font-bold flex items-center gap-1">
                                    <ShieldCheck className="w-3.5 h-3.5" /> Admin
                                  </span>
                                ) : (
                                  <span className="text-slate-400">Attendee</span>
                                )}
                              </td>
                              <td className="p-3">
                                {u.is_active ? (
                                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                    ACTIVE
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                                    DISABLED
                                  </span>
                                )}
                              </td>
                              <td className="p-3 flex items-center gap-2">
                                {/* Enable / Disable Button */}
                                {canToggleStatus ? (
                                  <button
                                    onClick={() => handleToggleUserStatus(u.id, u.email, u.is_active, u.is_admin)}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all active:scale-95 ${
                                      u.is_active
                                        ? 'bg-red-950/40 hover:bg-red-900 text-red-300 border-red-500/30'
                                        : 'bg-emerald-950/40 hover:bg-emerald-900 text-emerald-300 border-emerald-500/30'
                                    }`}
                                    title={u.is_active ? "Disable User Access" : "Enable User Access"}
                                  >
                                    {u.is_active ? (
                                      <>
                                        <UserX className="w-3.5 h-3.5" /> Disable
                                      </>
                                    ) : (
                                      <>
                                        <UserCheck className="w-3.5 h-3.5" /> Enable
                                      </>
                                    )}
                                  </button>
                                ) : (
                                  /* Disabled state indicator if admin lacks privilege to disable this target user */
                                  <span className="text-[10px] text-slate-500 font-mono italic">Protected</span>
                                )}

                                {/* Delete User Button (Super Admin Only) */}
                                {canDelete && (
                                  <button
                                    onClick={() => setDeleteModalUser({ id: u.id, email: u.email })}
                                    className="p-1 rounded-lg bg-slate-900 hover:bg-red-900 text-slate-400 hover:text-red-300 transition-all border border-white/5"
                                    title="Delete User"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Stream Manager & Passcode */}
        {activeTab === 'stream' && (
          <div className={`grid grid-cols-1 ${isSuperAdmin ? 'md:grid-cols-2' : ''} gap-6 animate-fadeIn`}>
            {/* Stream Settings Form */}
            <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <Video className="w-5 h-5 text-amber-400" /> YouTube Live Stream & Offline Banner Config
              </h3>

              <form onSubmit={handleUpdateStream} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Stream Title</label>
                  <input
                    type="text"
                    value={streamTitle}
                    onChange={(e) => setStreamTitle(e.target.value)}
                    className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">YouTube Stream URL / Video ID</label>
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=jfKfPfyJRdk"
                    className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Offline Placeholder Image URL</label>
                  <input
                    type="text"
                    value={offlineImageUrl}
                    onChange={(e) => setOfflineImageUrl(e.target.value)}
                    placeholder="https://example.com/offline-poster.jpg"
                    className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Offline Message Notice</label>
                  <input
                    type="text"
                    value={offlineMessage}
                    onChange={(e) => setOfflineMessage(e.target.value)}
                    className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                {offlineImageUrl && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                      <ImageIcon className="w-3.5 h-3.5 text-amber-400" /> Offline Image Preview:
                    </span>
                    <img
                      src={offlineImageUrl}
                      alt="Offline Preview"
                      className="w-full h-32 object-cover rounded-xl border border-white/10"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all"
                >
                  Save Stream & Offline Config
                </button>
              </form>
            </div>

            {/* Event Passcode Manager — Super Admin only. Regular Admins
                don't get this card at all (not even read-only/disabled
                fields), since the backend now rejects the whole endpoint
                for them, not just individual fields. */}
            {isSuperAdmin && (
              <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
                <h3 className="text-white font-bold text-base flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-amber-400" /> System Passcodes Settings
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold uppercase ml-auto">
                    Super Admin Only
                  </span>
                </h3>

                <form onSubmit={handlePasscodeUpdate} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Attendee Common Passcode</label>
                    <input
                      type="text"
                      value={attendeePasscode}
                      onChange={(e) => setAttendeePasscode(e.target.value)}
                      className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500 font-mono tracking-widest font-bold"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Passcode used by all attendees to log in.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Admin Common Passcode</label>
                    <input
                      type="password"
                      value={adminPasscode}
                      onChange={(e) => setAdminPasscode(e.target.value)}
                      placeholder="Enter admin passcode"
                      className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500 font-mono tracking-widest font-bold"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Shared passcode used by every regular Administrator to log in.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Super Admin Passcode</label>
                    <input
                      type="password"
                      value={superAdminPasscode}
                      onChange={(e) => setSuperAdminPasscode(e.target.value)}
                      placeholder="Enter super admin passcode"
                      className="w-full p-3 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500 font-mono tracking-widest font-bold"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Only used by events@chennaimath.org — kept separate from the Admin Common Passcode above so regular Administrators can't log in as Super Admin with it.
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-white/10 transition-all"
                  >
                    Update Passcodes
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Q&A Moderation Stream */}
        {activeTab === 'qna' && (
          <div className="bg-slate-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-400" /> Live Questions Stream ({adminQuestions.length})
              </h3>
              <button
                onClick={fetchAdminQuestions}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Queue</span>
              </button>
            </div>

            {adminQuestions.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">No questions submitted yet.</div>
            ) : (
              <div className="space-y-3">
                {adminQuestions.map((q) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-xl bg-slate-950 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-amber-400 font-semibold">{q.user_email}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(q.created_at).toLocaleTimeString()}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                          {q.upvotes} Upvotes
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            q.status === 'ANSWERED'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : q.status === 'APPROVED'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {q.status}
                        </span>
                      </div>
                      <p className="text-sm text-slate-200">{q.question_text}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {q.status !== 'ANSWERED' && (
                        <button
                          onClick={() => handleModerateQuestion(q.id, 'ANSWERED')}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition-all"
                        >
                          <Check className="w-3.5 h-3.5" /> Mark Answered
                        </button>
                      )}

                      <button
                        onClick={() => handleModerateQuestion(q.id, 'DELETE')}
                        className="p-1.5 rounded-lg bg-red-950/50 hover:bg-red-900 text-red-400 border border-red-500/20 transition-all"
                        title="Delete Question"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom Confirmation Modal Dialog (No browser confirm windows!) */}
      <ConfirmModal
        isOpen={!!deleteModalUser}
        title="Delete User from Roster"
        message={`Are you sure you want to permanently delete ${deleteModalUser?.email} from the roster?`}
        confirmText="Delete User"
        cancelText="Cancel"
        isDanger={true}
        onConfirm={handleConfirmDeleteUser}
        onCancel={() => setDeleteModalUser(null)}
      />

      <ConfirmModal
        isOpen={showFallbackConfirm}
        title="Enable Emergency Fallback?"
        message="This immediately bypasses login, Q&A, tab-lock, and the protected player for EVERY visitor — they'll see nothing but a bare video embed until you disable this again. Only use this if the normal app is genuinely broken."
        confirmText="Enable Fallback"
        cancelText="Cancel"
        isDanger={true}
        onConfirm={() => handleToggleEmergencyFallback(true)}
        onCancel={() => setShowFallbackConfirm(false)}
      />
    </div>
  );
};
