import React, { useState } from 'react';
import { BookOpen, Check, UserCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  approvePendingEnrollment,
  declinePendingEnrollment,
  reviewRegistrationRequest,
} from '../lib/lmsFirestore';
import { formatManilaDateTime } from '../lib/dateTime';
import { Enrollment, RegistrationRequest } from '../types';

interface ApprovalsPanelProps {
  registrationRequests: RegistrationRequest[];
  pendingEnrollments: Enrollment[];
  onClose: () => void;
  onNotify: (message: string, tone?: 'info' | 'success' | 'warn') => void;
}

export const ApprovalsPanel: React.FC<ApprovalsPanelProps> = ({
  registrationRequests,
  pendingEnrollments,
  onClose,
  onNotify,
}) => {
  const { user, profile } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingRegistrations = registrationRequests.filter((r) => r.status === 'pending');

  const handleReviewRegistration = async (
    req: RegistrationRequest,
    decision: 'approved' | 'rejected'
  ) => {
    if (!user) return;
    setBusyId(req.id);
    try {
      await reviewRegistrationRequest({
        requestId: req.id,
        status: decision,
        reviewerUid: user.uid,
        reviewerName: profile?.displayName || user.displayName || user.email || 'Instructor',
      });
      onNotify(
        decision === 'approved'
          ? `Approved student registration for ${req.displayName}. They can now browse courses and request enrollment.`
          : `Declined student registration for ${req.displayName}.`,
        decision === 'approved' ? 'success' : 'info'
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to update registration request.',
        'warn'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewEnrollment = async (enrollment: Enrollment, approve: boolean) => {
    setBusyId(enrollment.id);
    try {
      if (approve) {
        await approvePendingEnrollment(enrollment);
        onNotify(
          `Approved ${enrollment.memberName} for ${enrollment.courseCode}. Use "Sync Cohort Drive Access" in the course Roster tab to grant viewer-only file permissions.`,
          'success'
        );
      } else {
        await declinePendingEnrollment(enrollment);
        onNotify(
          `Declined enrollment request from ${enrollment.memberName} for ${enrollment.courseCode}.`,
          'info'
        );
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to update course enrollment request.',
        'warn'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-[#F5F1E8] border border-[#E5DFD3] rounded-lg p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 border-b border-[#E5DFD3] pb-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-[#1E3A8A] shrink-0" />
            <h3 className="text-lg sm:text-xl font-serif font-semibold text-[#1C1917]">
              Student Registrations &amp; Course Enrollment Approvals
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-[#57534E] leading-relaxed">
            Review new student accounts before granting app access, and approve student course
            enrollment requests to unlock protected recordings, downloads, and lesson resources.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[#57534E] hover:text-[#1C1917] min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-md shrink-0"
          aria-label="Close approvals panel"
        >
          <X className="w-5 h-5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* Section 1: Pending Student App Registrations */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-mono text-[#1E3A8A] font-medium">
            01. Student Account Registrations ({pendingRegistrations.length} Pending)
          </p>
        </div>

        {pendingRegistrations.length === 0 ? (
          <p className="text-xs text-[#57534E] bg-[#FBF9F5] border border-[#E5DFD3] rounded-md px-4 py-3">
            No pending student registration requests right now.
          </p>
        ) : (
          <div className="divide-y divide-[#E5DFD3] bg-[#FBF9F5] border border-[#E5DFD3] rounded-md">
            {pendingRegistrations.map((req) => {
              const submittedIso = req.createdAt?.toDate?.()?.toISOString();
              const isBusy = busyId === req.id;
              return (
                <div
                  key={req.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-medium text-[#1C1917]">{req.displayName}</p>
                    <p className="text-xs font-mono text-[#57534E] break-all">
                      {req.email}
                      {req.department && (
                        <>
                          <span className="mx-1.5">·</span>
                          <span className="font-sans text-[#1C1917]">{req.department}</span>
                        </>
                      )}
                      {submittedIso && (
                        <>
                          <span className="mx-1.5">·</span>
                          <span>{formatManilaDateTime(submittedIso)}</span>
                        </>
                      )}
                    </p>
                    {req.note && (
                      <p className="text-xs text-[#57534E] leading-relaxed">
                        Note: {req.note}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleReviewRegistration(req, 'approved')}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#14532D] hover:bg-[#0F3F22] rounded-md disabled:opacity-60 whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleReviewRegistration(req, 'rejected')}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md disabled:opacity-60 whitespace-nowrap"
                    >
                      <X className="w-3.5 h-3.5 shrink-0" />
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Pending Course Enrollment Requests */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-mono text-[#1E3A8A] font-medium inline-flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span>02. Course Enrollment Requests ({pendingEnrollments.length} Pending)</span>
          </p>
        </div>

        {pendingEnrollments.length === 0 ? (
          <p className="text-xs text-[#57534E] bg-[#FBF9F5] border border-[#E5DFD3] rounded-md px-4 py-3">
            No pending course enrollment requests right now.
          </p>
        ) : (
          <div className="divide-y divide-[#E5DFD3] bg-[#FBF9F5] border border-[#E5DFD3] rounded-md">
            {pendingEnrollments.map((enr) => {
              const requestedIso = enr.createdAt?.toDate?.()?.toISOString();
              const isBusy = busyId === enr.id;
              return (
                <div
                  key={enr.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="text-xs font-mono text-[#1E3A8A] font-medium">
                      {enr.courseCode} — {enr.courseTitle}
                    </p>
                    <p className="text-sm font-medium text-[#1C1917]">{enr.memberName}</p>
                    <p className="text-xs font-mono text-[#57534E] break-all">
                      {enr.memberEmail}
                      {requestedIso && (
                        <>
                          <span className="mx-1.5">·</span>
                          <span>Requested {formatManilaDateTime(requestedIso)}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleReviewEnrollment(enr, true)}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-white bg-[#14532D] hover:bg-[#0F3F22] rounded-md disabled:opacity-60 whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>Approve</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleReviewEnrollment(enr, false)}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 sm:py-1.5 text-xs font-medium text-[#78350F] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md disabled:opacity-60 whitespace-nowrap"
                    >
                      <X className="w-3.5 h-3.5 shrink-0" />
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
