import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  LogOut,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export type AccountModalTab = 'profile' | 'settings';

interface AccountProfileModalProps {
  open: boolean;
  initialTab: AccountModalTab;
  onClose: () => void;
}

const MAX_RAW_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 90000;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function isAllowedPhotoInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 100000) return false;
  return (
    /^https:\/\/\S+$/.test(trimmed) ||
    /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)
  );
}

async function resizeImageToDataUrl(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Please choose a PNG, JPG, or WebP image file.');
  }
  if (file.size > MAX_RAW_PHOTO_BYTES) {
    throw new Error('Selected image must be under 10 MB.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to decode the selected image.'));
      el.src = objectUrl;
    });

    const attempts: Array<{ size: number; quality: number }> = [
      { size: 192, quality: 0.82 },
      { size: 160, quality: 0.72 },
      { size: 128, quality: 0.65 },
    ];

    const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = Math.max(0, Math.floor(((img.naturalWidth || img.width) - side) / 2));
    const sy = Math.max(0, Math.floor(((img.naturalHeight || img.height) - side) / 2));

    for (const attempt of attempts) {
      const canvas = document.createElement('canvas');
      canvas.width = attempt.size;
      canvas.height = attempt.size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image processing is unavailable in this browser.');
      ctx.drawImage(img, sx, sy, side, side, 0, 0, attempt.size, attempt.size);
      const dataUrl = canvas.toDataURL('image/jpeg', attempt.quality);
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) {
        return dataUrl;
      }
    }

    throw new Error('Photo is still too large after compression. Try a smaller image or HTTPS link.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const AccountProfileModal: React.FC<AccountProfileModalProps> = ({
  open,
  initialTab,
  onClose,
}) => {
  const {
    user,
    profile,
    effectiveRole,
    isPreviewing,
    workspaceToken,
    rememberedAccount,
    updateAccountProfile,
    connectWorkspace,
    forgetDevice,
    signOut,
  } = useAuth();
  const { theme, setTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<AccountModalTab>(initialTab);
  const [displayName, setDisplayName] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoLinkInput, setPhotoLinkInput] = useState('');
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [connectingWorkspace, setConnectingWorkspace] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: 'success' | 'error';
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    const currentName = profile?.displayName || user?.displayName || '';
    const currentPhoto = profile?.photoUrl || user?.photoURL || '';
    setDisplayName(currentName);
    setPhotoUrl(currentPhoto);
    setPhotoLinkInput(currentPhoto.startsWith('https://') ? currentPhoto : '');
    setPhotoRemoved(false);
    setFeedback(null);
  }, [open, initialTab, profile?.displayName, profile?.photoUrl, user?.displayName, user?.photoURL]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !user) return null;

  const canSaveProfile = Boolean(profile);
  const effectivePreviewPhoto = photoRemoved ? '' : photoUrl;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setProcessingPhoto(true);
    setFeedback(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setPhotoUrl(dataUrl);
      setPhotoLinkInput('');
      setPhotoRemoved(false);
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : 'Unable to process photo.',
        tone: 'error',
      });
    } finally {
      setProcessingPhoto(false);
    }
  };

  const handleApplyPhotoLink = () => {
    const trimmed = photoLinkInput.trim();
    if (!trimmed) {
      setPhotoUrl('');
      setPhotoRemoved(true);
      setFeedback(null);
      return;
    }
    if (!/^https:\/\/\S+$/.test(trimmed)) {
      setFeedback({
        message: 'Photo link must start with https:// and contain no spaces.',
        tone: 'error',
      });
      return;
    }
    setPhotoUrl(trimmed);
    setPhotoRemoved(false);
    setFeedback(null);
  };

  const handleRemovePhoto = () => {
    setPhotoUrl('');
    setPhotoLinkInput('');
    setPhotoRemoved(true);
    setFeedback(null);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSaveProfile) return;

    const cleanName = displayName.trim();
    if (!cleanName) {
      setFeedback({ message: 'Please enter a display name for your account.', tone: 'error' });
      return;
    }

    const nextPhoto = photoRemoved
      ? null
      : photoUrl.trim()
        ? photoUrl.trim()
        : undefined;

    if (typeof nextPhoto === 'string' && !isAllowedPhotoInput(nextPhoto)) {
      setFeedback({
        message: 'Please upload a PNG/JPG/WebP image or use a valid https:// image URL.',
        tone: 'error',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await updateAccountProfile({
        displayName: cleanName,
        photoUrl: nextPhoto,
      });
      setFeedback({ message: 'Profile changes saved.', tone: 'success' });
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : 'Unable to save profile changes.',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReconnectWorkspace = async () => {
    setConnectingWorkspace(true);
    setFeedback(null);
    try {
      const token = await connectWorkspace();
      if (token) {
        setFeedback({ message: 'Google Workspace permissions refreshed.', tone: 'success' });
      }
    } finally {
      setConnectingWorkspace(false);
    }
  };

  const handleSignOutClick = async () => {
    onClose();
    await signOut();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-[#1C1917]/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-lg bg-[#FBF9F5] border border-[#E5DFD3] rounded-t-xl sm:rounded-lg shadow-xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-[#E5DFD3] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="account-modal-title"
              className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]"
            >
              {activeTab === 'profile' ? 'Account Profile' : 'Account Settings'}
            </h2>
            <p className="text-xs font-mono text-[#57534E] truncate mt-0.5">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account modal"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-[#57534E] hover:text-[#1C1917] rounded-md hover:bg-[#EBE6DF] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="px-5 sm:px-6 border-b border-[#E5DFD3] flex items-center gap-6 bg-[#F5F1E8]">
          <button
            type="button"
            onClick={() => {
              setActiveTab('profile');
              setFeedback(null);
            }}
            className={`inline-flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'profile'
                ? 'border-[#1E3A8A] text-[#1C1917]'
                : 'border-transparent text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Profile</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('settings');
              setFeedback(null);
            }}
            className={`inline-flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'settings'
                ? 'border-[#1E3A8A] text-[#1C1917]'
                : 'border-transparent text-[#57534E] hover:text-[#1C1917]'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {feedback && (
            <div
              role="status"
              className={`px-3.5 py-2.5 rounded-md border text-xs leading-relaxed bg-[#F5F1E8] ${
                feedback.tone === 'success'
                  ? 'border-[#E5DFD3] text-[#14532D]'
                  : 'border-[#E5DFD3] text-[#78350F]'
              }`}
            >
              {feedback.message}
            </div>
          )}

          {activeTab === 'profile' ? (
            <form onSubmit={handleSaveProfile} className="space-y-5">
              {/* Avatar Photo Picker */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-5 border-b border-[#E5DFD3]">
                <div className="relative w-16 h-16 rounded-full overflow-hidden border border-[#E5DFD3] bg-[#F5F1E8] flex items-center justify-center shrink-0">
                  {effectivePreviewPhoto ? (
                    <img
                      src={effectivePreviewPhoto}
                      alt={displayName || 'Profile photo'}
                      onError={() => setPhotoRemoved(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="font-serif text-xl font-semibold text-[#1E3A8A]">
                      {getInitials(displayName || user.email || 'U')}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-xs font-medium text-[#1C1917]">Profile Photo</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={!canSaveProfile || processingPhoto || saving}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors disabled:opacity-60"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{processingPhoto ? 'Processing…' : 'Upload Photo'}</span>
                    </button>
                    {effectivePreviewPhoto && (
                      <button
                        type="button"
                        disabled={!canSaveProfile || saving}
                        onClick={handleRemovePhoto}
                        className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors disabled:opacity-60"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove Photo</span>
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-[#57534E]">
                    PNG, JPG, or WebP. Automatically cropped square for fast loading.
                  </p>
                </div>
              </div>

              {/* Optional HTTPS Image URL */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#57534E]">
                  Or Paste Image URL (optional)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={photoLinkInput}
                    onChange={(e) => setPhotoLinkInput(e.target.value)}
                    disabled={!canSaveProfile || saving}
                    placeholder="https://example.com/avatar.jpg"
                    className="flex-1 min-w-0 min-h-[40px] px-3 py-2 text-sm bg-[#F5F1E8] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A] disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={!canSaveProfile || saving}
                    onClick={handleApplyPhotoLink}
                    className="min-h-[40px] px-3 py-2 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors disabled:opacity-60 whitespace-nowrap"
                  >
                    Use URL
                  </button>
                </div>
              </div>

              {/* Display Name (Rename Account) */}
              <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-[#57534E]">
                  Account Name
                </span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={!canSaveProfile || saving}
                  maxLength={120}
                  required
                  placeholder="Enter your full name"
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-[#F5F1E8] border border-[#E5DFD3] rounded-md text-[#1C1917] focus:outline-none focus:border-[#1E3A8A] disabled:opacity-60"
                />
              </label>

              {/* Read-only Role & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-[#F5F1E8] border border-[#E5DFD3] rounded-md text-xs">
                <div>
                  <span className="block text-[#57534E]">Email Address</span>
                  <span className="font-mono text-[#1C1917] break-all">{user.email}</span>
                </div>
                <div>
                  <span className="block text-[#57534E]">Account Role</span>
                  <span className="font-medium capitalize text-[#1C1917]">
                    {effectiveRole}
                    {isPreviewing ? ' (Preview)' : ''}
                  </span>
                </div>
              </div>

              {!canSaveProfile && (
                <p className="text-xs text-[#78350F]">
                  Complete and submit your student registration form first to save profile edits.
                </p>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-3 border-t border-[#E5DFD3]">
                <button
                  type="button"
                  onClick={handleSignOutClick}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-3.5 py-2 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 sm:flex-initial min-h-[42px] px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] rounded-md transition-colors"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={!canSaveProfile || saving || processingPhoto}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors disabled:opacity-60"
                  >
                    <Check className="w-4 h-4" />
                    <span>{saving ? 'Saving…' : 'Save Profile'}</span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              {/* Appearance Toggle (Light / Dark Mode) */}
              <div className="p-4 bg-[#F5F1E8] border border-[#E5DFD3] rounded-md space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#1C1917]">Appearance</p>
                    <p className="text-xs text-[#57534E]">
                      Switch between Light and Dark mode.
                    </p>
                  </div>
                </div>
                <div
                  role="group"
                  aria-label="Theme mode"
                  className="grid grid-cols-2 gap-2"
                >
                  <button
                    type="button"
                    aria-pressed={theme === 'light'}
                    onClick={() => setTheme('light')}
                    className={`inline-flex items-center justify-center gap-2 min-h-[42px] px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                      theme === 'light'
                        ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                        : 'bg-[#FBF9F5] text-[#1C1917] border-[#E5DFD3] hover:bg-[#EBE6DF]'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span>Light Mode</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={theme === 'dark'}
                    onClick={() => setTheme('dark')}
                    className={`inline-flex items-center justify-center gap-2 min-h-[42px] px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                      theme === 'dark'
                        ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                        : 'bg-[#FBF9F5] text-[#1C1917] border-[#E5DFD3] hover:bg-[#EBE6DF]'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>Dark Mode</span>
                  </button>
                </div>
              </div>

              {/* Workspace & Device Preferences */}
              <div className="p-4 bg-[#F5F1E8] border border-[#E5DFD3] rounded-md space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1C1917]">Google Workspace Access</p>
                    <p className="text-xs text-[#57534E]">
                      {workspaceToken
                        ? 'Connected for Google Drive, Calendar, and Meet.'
                        : 'Authorize Google Workspace when creating or viewing Drive resources.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={connectingWorkspace}
                    onClick={handleReconnectWorkspace}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium text-[#1C1917] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors whitespace-nowrap disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${connectingWorkspace ? 'animate-spin' : ''}`} />
                    <span>{workspaceToken ? 'Refresh' : 'Connect'}</span>
                  </button>
                </div>

                {rememberedAccount && (
                  <div className="pt-3 border-t border-[#E5DFD3] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[#1C1917]">Remembered Device</p>
                      <p className="text-[11px] font-mono text-[#57534E] truncate">
                        {rememberedAccount.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => forgetDevice()}
                      className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-[#78350F] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors whitespace-nowrap"
                    >
                      Forget Device
                    </button>
                  </div>
                )}
              </div>

              {/* Sign Out Section */}
              <div className="pt-3 border-t border-[#E5DFD3] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleSignOutClick}
                  className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-[#78350F] hover:bg-[#5E290B] rounded-md transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[42px] px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] rounded-md transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
