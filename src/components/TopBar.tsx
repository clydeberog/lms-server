import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  FileText,
  LogOut,
  Moon,
  Settings,
  Sun,
  User as UserIcon,
  Video,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ActiveNavTab } from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';
import { AccountModalTab, AccountProfileModal } from './AccountProfileModal';

interface TopBarProps {
  activeTab: ActiveNavTab;
  onSelectTab: (tab: ActiveNavTab) => void;
}

const NAV_ITEMS: Array<{
  id: ActiveNavTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'courses', label: 'Courses', Icon: BookOpen },
  { id: 'classes', label: 'Classes', Icon: Video },
  { id: 'resources', label: 'Resources', Icon: FileText },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const TopBar: React.FC<TopBarProps> = ({ activeTab, onSelectTab }) => {
  const { user, profile, isApproved, effectiveRole, isPreviewing, isSigningIn, signIn, signOut } =
    useAuth();
  const { theme, setTheme } = useTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<AccountModalTab>('profile');
  const [avatarFailed, setAvatarFailed] = useState(false);

  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  const showNavigation = Boolean(user && isApproved);
  const displayName = profile?.displayName || user?.displayName || 'Account';
  const avatarSrc = !avatarFailed ? profile?.photoUrl || user?.photoURL || '' : '';

  useEffect(() => {
    setAvatarFailed(false);
  }, [profile?.photoUrl, user?.photoURL]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const openAccountModal = (tab: AccountModalTab) => {
    setMenuOpen(false);
    setModalTab(tab);
    setModalOpen(true);
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#FBF9F5]/95 backdrop-blur-sm border-b border-[#E5DFD3]">
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 h-14 md:h-16 flex items-center justify-between gap-3 md:gap-8">
          {/* Zone 1: Brand Emblem + Single-line Wordmark */}
          <button
            type="button"
            onClick={() => onSelectTab('courses')}
            className="inline-flex items-center gap-2 sm:gap-2.5 min-w-0 font-serif text-base sm:text-lg md:text-xl font-semibold tracking-tight text-[#1C1917] hover:text-[#1E3A8A] transition-colors"
          >
            <img
              src="/assets/aistudio/4a52c352-b439-44b9-9ab2-e11bf7c67dfe_57428442.jpg"
              alt="NLFBC - School of Ministry logo"
              className="w-8 h-8 md:w-9 md:h-9 rounded-full object-contain bg-white border border-[#E5DFD3] shrink-0"
            />
            <span className="truncate">NLFBC - School of Ministry</span>
          </button>

          {/* Zone 2: Clean Single-Line Text Navigation Links (Desktop — Approved Users Only) */}
          {showNavigation && (
            <nav
              aria-label="Primary navigation"
              className="hidden md:flex items-center gap-7 text-sm font-medium shrink-0"
            >
              {NAV_ITEMS.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectTab(item.id)}
                    className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                      isActive
                        ? 'border-[#1E3A8A] text-[#1C1917]'
                        : 'border-transparent text-[#57534E] hover:text-[#1C1917]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          )}

          {/* Zone 3: Signed-In Account Menu (Profile, Settings, Theme Toggle, Sign Out) */}
          <div className="flex items-center shrink-0">
            {user ? (
              <div ref={menuContainerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={`Account menu (${displayName})`}
                  className="inline-flex items-center gap-2 min-h-[40px] pl-1.5 pr-2.5 sm:pr-3 py-1 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt=""
                      onError={() => setAvatarFailed(true)}
                      className="w-7 h-7 rounded-full object-cover border border-[#E5DFD3] shrink-0"
                    />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-[#1E3A8A] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                      {getInitials(displayName || user.email || 'U')}
                    </span>
                  )}
                  <span className="max-w-[92px] sm:max-w-[150px] truncate">{displayName}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#57534E] shrink-0 transition-transform ${
                      menuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    aria-label="Signed-in account options"
                    className="absolute right-0 mt-2 w-64 bg-[#FBF9F5] border border-[#E5DFD3] rounded-lg shadow-xl py-1.5 z-50"
                  >
                    {/* Account Identity Summary */}
                    <div className="px-3.5 py-2.5 border-b border-[#E5DFD3] flex items-center gap-2.5">
                      {avatarSrc ? (
                        <img
                          src={avatarSrc}
                          alt=""
                          onError={() => setAvatarFailed(true)}
                          className="w-9 h-9 rounded-full object-cover border border-[#E5DFD3] shrink-0"
                        />
                      ) : (
                        <span className="w-9 h-9 rounded-full bg-[#1E3A8A] text-white text-xs font-semibold flex items-center justify-center shrink-0">
                          {getInitials(displayName || user.email || 'U')}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#1C1917] truncate">
                          {displayName}
                        </p>
                        <p className="text-[11px] font-mono text-[#57534E] truncate">
                          {user.email}
                        </p>
                        <p className="text-[11px] font-mono capitalize text-[#1E3A8A] mt-0.5">
                          {effectiveRole}
                          {isPreviewing ? ' (Preview)' : ''}
                        </p>
                      </div>
                    </div>

                    {/* Profile & Settings Navigation */}
                    <div className="py-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openAccountModal('profile')}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 min-h-[42px] text-xs font-medium text-[#1C1917] hover:bg-[#EBE6DF] transition-colors text-left"
                      >
                        <UserIcon className="w-4 h-4 text-[#57534E] shrink-0" />
                        <span>Profile</span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openAccountModal('settings')}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 min-h-[42px] text-xs font-medium text-[#1C1917] hover:bg-[#EBE6DF] transition-colors text-left"
                      >
                        <Settings className="w-4 h-4 text-[#57534E] shrink-0" />
                        <span>Settings</span>
                      </button>
                    </div>

                    {/* Quick Light & Dark Mode Toggles */}
                    <div className="px-3.5 py-2 border-t border-[#E5DFD3] space-y-1.5">
                      <span className="block text-[11px] font-mono text-[#57534E]">
                        Appearance
                      </span>
                      <div
                        role="group"
                        aria-label="Theme toggle"
                        className="grid grid-cols-2 gap-1.5"
                      >
                        <button
                          type="button"
                          aria-pressed={theme === 'light'}
                          onClick={() => setTheme('light')}
                          className={`inline-flex items-center justify-center gap-1.5 min-h-[34px] px-2 py-1 text-[11px] font-medium rounded border transition-colors ${
                            theme === 'light'
                              ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                              : 'bg-[#F5F1E8] text-[#1C1917] border-[#E5DFD3] hover:bg-[#EBE6DF]'
                          }`}
                        >
                          <Sun className="w-3.5 h-3.5" />
                          <span>Light</span>
                        </button>
                        <button
                          type="button"
                          aria-pressed={theme === 'dark'}
                          onClick={() => setTheme('dark')}
                          className={`inline-flex items-center justify-center gap-1.5 min-h-[34px] px-2 py-1 text-[11px] font-medium rounded border transition-colors ${
                            theme === 'dark'
                              ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                              : 'bg-[#F5F1E8] text-[#1C1917] border-[#E5DFD3] hover:bg-[#EBE6DF]'
                          }`}
                        >
                          <Moon className="w-3.5 h-3.5" />
                          <span>Dark</span>
                        </button>
                      </div>
                    </div>

                    {/* Lastly: Sign Out */}
                    <div className="pt-1 border-t border-[#E5DFD3]">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          void signOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 min-h-[42px] text-xs font-medium text-[#78350F] hover:bg-[#EBE6DF] transition-colors text-left"
                      >
                        <LogOut className="w-4 h-4 shrink-0" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <GoogleSignInButton
                onClick={() => signIn()}
                disabled={isSigningIn}
                mobileLabel="Sign in"
              />
            )}
          </div>
        </div>
      </header>

      {/* Thumb-Zone Mobile Bottom Tab Bar (Approved Signed-in Users Only) */}
      {showNavigation && (
        <nav
          aria-label="Mobile navigation"
          className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#FBF9F5]/95 backdrop-blur-md border-t border-[#E5DFD3] pb-safe"
        >
          <div className="grid grid-cols-3">
            {NAV_ITEMS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectTab(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex flex-col items-center justify-center gap-1 min-h-[56px] px-2 py-2 text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'text-[#1E3A8A]'
                      : 'text-[#57534E] active:text-[#1C1917]'
                  }`}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 inset-x-6 h-0.5 bg-[#1E3A8A] rounded-b-full"
                    />
                  )}
                  <Icon
                    className={`w-5 h-5 shrink-0 ${
                      isActive ? 'text-[#1E3A8A]' : 'text-[#57534E]'
                    }`}
                  />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <AccountProfileModal
        open={modalOpen}
        initialTab={modalTab}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
};
