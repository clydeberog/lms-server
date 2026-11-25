import React, { useState } from 'react';
import { Clock, LogOut, RefreshCw, ShieldAlert, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LOGO_IMAGE_SRC = '/assets/aistudio/4a52c352-b439-44b9-9ab2-e11bf7c67dfe_57428442.jpg';

interface StudentRegistrationGateProps {
  onNotify: (message: string, tone?: 'info' | 'success' | 'warn') => void;
}

export const StudentRegistrationGate: React.FC<StudentRegistrationGateProps> = ({ onNotify }) => {
  const {
    user,
    profile,
    needsRegistration,
    approvalStatus,
    submitRegistration,
    refreshProfile,
    signOut,
  } = useAuth();

  const [displayName, setDisplayName] = useState(
    () => user?.displayName || user?.email?.split('@')[0] || ''
  );
  const [department, setDepartment] = useState('Biblical Studies');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);

  if (!user) return null;

  const handleRegistrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      onNotify('Please enter your full name to complete student registration.', 'warn');
      return;
    }
    setSubmitting(true);
    try {
      await submitRegistration({
        displayName: displayName.trim(),
        department: department.trim() || undefined,
        note: note.trim() || undefined,
      });
      onNotify(
        'Registration submitted. An admin or instructor will review and approve your account.',
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to submit registration.', 'warn');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async () => {
    setChecking(true);
    try {
      await refreshProfile();
      onNotify('Checked your latest registration approval status.', 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to refresh status.', 'warn');
    } finally {
      setChecking(false);
    }
  };

  if (needsRegistration) {
    return (
      <section className="max-w-2xl mx-auto py-4 sm:py-8">
        <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-6 sm:p-8 space-y-6">
          <div className="flex items-start gap-4 border-b border-[#E5DFD3] pb-5">
            <img
              src={LOGO_IMAGE_SRC}
              alt="NLFBC - School of Ministry"
              className="w-12 h-12 rounded-full object-contain bg-white border border-[#E5DFD3] shrink-0"
            />
            <div className="space-y-1 min-w-0">
              <p className="text-xs font-mono text-[#1E3A8A]">Student Registration</p>
              <h1 className="text-2xl sm:text-3xl font-serif font-semibold text-[#1C1917]">
                Complete Your Student Registration
              </h1>
              <p className="text-sm text-[#57534E] leading-relaxed">
                Submit your student details below. An administrator or instructor will review and
                approve your registration before granting access to the portal.
              </p>
            </div>
          </div>

          <form onSubmit={handleRegistrationSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-[#57534E]">
                Verified Google Account
              </span>
              <p className="px-3 py-2.5 text-sm font-mono text-[#1C1917] bg-[#FBF9F5] border border-[#E5DFD3] rounded-md break-all">
                {user.email}
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-[#57534E]">Full Name</span>
              <input
                type="text"
                required
                maxLength={120}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., Hannah Grace Reyes"
                className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-[#57534E]">
                Ministry / Program Track (Optional)
              </span>
              <input
                type="text"
                maxLength={100}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g., Biblical Studies, Pastoral Ministry, Youth Ministry"
                className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-[#57534E]">
                Note to Instructor / Admin (Optional)
              </span>
              <textarea
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Share your church fellowship or courses you intend to enroll in."
                className="w-full px-3 py-2 text-base sm:text-sm bg-[#FBF9F5] border border-[#E5DFD3] rounded-md focus:outline-none focus:border-[#1E3A8A]"
              />
            </label>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-[#E5DFD3]">
              <button
                type="button"
                onClick={() => signOut()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] sm:border-transparent rounded-md"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-5 py-2.5 text-sm font-medium text-white bg-[#1E3A8A] hover:bg-[#172E6E] rounded-md transition-colors disabled:opacity-60"
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>{submitting ? 'Submitting Registration…' : 'Submit Registration'}</span>
              </button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  if (approvalStatus === 'rejected') {
    return (
      <section className="max-w-xl mx-auto py-8 sm:py-14">
        <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-full bg-[#FBF9F5] border border-[#E5DFD3] flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6 text-[#78350F]" />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-mono text-[#78350F]">Registration Declined</p>
            <h1 className="text-2xl sm:text-3xl font-serif font-semibold text-[#1C1917]">
              Registration Not Approved
            </h1>
            <p className="text-sm text-[#57534E] leading-relaxed">
              Your student registration for{' '}
              <span className="font-mono text-[#1C1917] break-all">{user.email}</span> was not
              approved by the school administration. Please contact your instructor or school
              administrator if you believe this was in error.
            </p>
          </div>
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-sm font-medium text-[#1C1917] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-2xl mx-auto py-6 sm:py-12">
      <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 border-b border-[#E5DFD3] pb-5">
          <img
            src={LOGO_IMAGE_SRC}
            alt="NLFBC - School of Ministry"
            className="w-14 h-14 rounded-full object-contain bg-white border border-[#E5DFD3] shrink-0"
          />
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-mono text-[#78350F] inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>Registration Pending Approval</span>
            </p>
            <h1 className="text-2xl sm:text-3xl font-serif font-semibold text-[#1C1917]">
              Your Registration Is Pending Approval
            </h1>
          </div>
        </div>

        <div className="space-y-3 text-sm text-[#57534E] leading-relaxed">
          <p>
            Thank you for registering with{' '}
            <strong className="text-[#1C1917]">NLFBC - School of Ministry</strong>. Your student
            account is currently waiting for approval from an administrator or instructor.
          </p>
          <p>
            Once your registration is approved, this page will automatically unlock so you can
            browse courses, request course enrollment, and access your approved classes.
          </p>
        </div>

        <div className="bg-[#FBF9F5] border border-[#E5DFD3] rounded-md p-4 space-y-2 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="text-[#57534E]">Registered Name</span>
            <span className="font-medium text-[#1C1917]">
              {profile?.displayName || user.displayName || 'Student'}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="text-[#57534E]">Google Account</span>
            <span className="font-mono text-[#1C1917] break-all">{user.email}</span>
          </div>
          {profile?.department && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <span className="text-[#57534E]">Ministry / Track</span>
              <span className="text-[#1C1917]">{profile.department}</span>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="text-[#57534E]">Account Status</span>
            <span className="font-mono font-medium text-[#78350F]">Pending Faculty Approval</span>
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => signOut()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] border border-[#E5DFD3] sm:border-transparent rounded-md"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
          <button
            type="button"
            disabled={checking}
            onClick={handleCheckStatus}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-[#1C1917] bg-[#FBF9F5] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? 'Checking Status…' : 'Check Approval Status'}</span>
          </button>
        </div>
      </div>
    </section>
  );
};
