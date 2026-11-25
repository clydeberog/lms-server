import React from 'react';
import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react';

export type LegalPageType = 'privacy' | 'terms';

interface LegalPageViewProps {
  page: LegalPageType;
  onNavigateHome: () => void;
  onNavigateLegal: (page: LegalPageType) => void;
}

const EFFECTIVE_DATE = 'November 25, 2026';
const CONTACT_EMAIL = 'clydefrancis.berog39@gmail.com';

export const LegalPageView: React.FC<LegalPageViewProps> = ({
  page,
  onNavigateHome,
  onNavigateLegal,
}) => {
  const isPrivacy = page === 'privacy';

  return (
    <article className="max-w-3xl mx-auto space-y-8">
      {/* Top Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E5DFD3]">
        <button
          type="button"
          onClick={onNavigateHome}
          className="inline-flex items-center gap-2 min-h-[40px] px-3 py-1.5 text-xs font-medium text-[#1C1917] bg-[#F5F1E8] hover:bg-[#EBE6DF] border border-[#E5DFD3] rounded-md transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-[#57534E]" />
          <span>Back to NLFBC - School of Ministry</span>
        </button>

        <div className="inline-flex items-center gap-2">
          <a
            href="/privacy"
            onClick={(e) => {
              e.preventDefault();
              onNavigateLegal('privacy');
            }}
            className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              isPrivacy
                ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                : 'bg-[#F5F1E8] text-[#1C1917] border-[#E5DFD3] hover:bg-[#EBE6DF]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Privacy Policy</span>
          </a>
          <a
            href="/terms"
            onClick={(e) => {
              e.preventDefault();
              onNavigateLegal('terms');
            }}
            className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              !isPrivacy
                ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
                : 'bg-[#F5F1E8] text-[#1C1917] border-[#E5DFD3] hover:bg-[#EBE6DF]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Terms of Service</span>
          </a>
        </div>
      </div>

      {isPrivacy ? (
        <div className="space-y-8">
          <header className="space-y-2">
            <p className="text-xs font-mono text-[#1E3A8A]">
              Effective Date: {EFFECTIVE_DATE}
            </p>
            <h1 className="text-3xl sm:text-4xl font-serif font-semibold text-[#1C1917]">
              Privacy Policy
            </h1>
            <p className="text-sm sm:text-base text-[#57534E] leading-relaxed">
              This Privacy Policy explains how <strong>NLFBC - School of Ministry</strong>{' '}
              (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;the School&rdquo;) collects, uses,
              stores, and protects information when you use the NLFBC - School of Ministry Learning
              Management System (LMS).
            </p>
          </header>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              1. Information We Collect
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[#57534E] leading-relaxed">
              <li>
                <strong className="text-[#1C1917]">Account &amp; Profile Details:</strong> When you
                sign in or register using Google Sign-In (Firebase Authentication), we receive your
                verified email address, display name, unique account identifier, and Google profile
                photo. You may also update your display name, upload or link a profile photo, and
                optionally provide a ministry track or registration note.
              </li>
              <li>
                <strong className="text-[#1C1917]">Academic &amp; Course Activity:</strong> We
                store course enrollment requests and approvals, assigned roles (student,
                instructor, or administrator), live Google Meet attendance check-ins, lesson
                material metadata, and assignment submissions with instructor grades and written
                feedback.
              </li>
              <li>
                <strong className="text-[#1C1917]">Preferences &amp; Session Cookies:</strong> Your
                Light or Dark appearance preference is saved in your browser&apos;s local storage.
                If &ldquo;Remember this device&rdquo; is enabled, an encrypted, HttpOnly session
                cookie is used to keep your Google Workspace connection and device hint active.
              </li>
            </ul>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              2. How We Use Information
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[#57534E] leading-relaxed">
              <li>
                Verify user identity, review student registrations, and manage approved course
                enrollments.
              </li>
              <li>
                Provide access to scheduled live Google Meet lectures, class recordings, and
                viewer-only lesson study materials for enrolled students.
              </li>
              <li>
                Track class attendance when enrolled students join live sessions and support
                private student assignment uploads and faculty grading.
              </li>
              <li>
                Protect institutional resources through role-based access rules and audit security.
              </li>
            </ul>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              3. Google Workspace APIs &amp; Limited Use Compliance
            </h2>
            <p className="text-sm text-[#57534E] leading-relaxed">
              The LMS integrates with Google Calendar, Google Meet, and Google Drive solely to
              deliver classroom functionality requested by users:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[#57534E] leading-relaxed">
              <li>
                <strong className="text-[#1C1917]">Google Calendar &amp; Meet:</strong> Used by
                approved instructors and administrators to schedule live class meetings, generate
                Meet links, close completed invites, and sync session recordings.
              </li>
              <li>
                <strong className="text-[#1C1917]">Google Drive:</strong> Used to host course
                folders, upload and share lesson materials (viewer-only for approved enrolled
                students), stream class recordings, and store private student assignment files.
              </li>
            </ul>
            <p className="text-sm text-[#57534E] leading-relaxed">
              NLFBC - School of Ministry&apos;s use and transfer of information received from Google
              APIs adheres to the{' '}
              <strong className="text-[#1C1917]">
                Google API Services User Data Policy
              </strong>
              , including the Limited Use requirements. We do not sell Google user data, use it for
              advertising, or share it with third-party data brokers.
            </p>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              4. Data Access, Visibility &amp; Security
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[#57534E] leading-relaxed">
              <li>
                <strong className="text-[#1C1917]">Enrollment Gating:</strong> Course lesson
                materials, recordings, and Google Drive study files are restricted to approved
                enrolled members, course instructors, and school administrators.
              </li>
              <li>
                <strong className="text-[#1C1917]">Private Assignments &amp; Attendance:</strong>{' '}
                Submitted assignments and attendance logs are visible only to the relevant student,
                the course instructor, and authorized school administrators.
              </li>
              <li>
                <strong className="text-[#1C1917]">Administrative Drive Access:</strong> Full
                Google Drive course folder management is limited to instructors and administrators;
                students receive viewer-only access to shared study files and recordings.
              </li>
            </ul>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              5. Data Retention, Your Rights &amp; Contact
            </h2>
            <p className="text-sm text-[#57534E] leading-relaxed">
              You may rename your account or update/remove your profile photo at any time from the
              Account menu, forget a remembered device in Settings, or revoke Google OAuth access at{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1E3A8A] hover:underline break-all"
              >
                https://myaccount.google.com/permissions
              </a>
              . To request export or deletion of your student account records, please contact the
              school administrator at{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-[#1E3A8A] hover:underline break-all"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>
      ) : (
        <div className="space-y-8">
          <header className="space-y-2">
            <p className="text-xs font-mono text-[#1E3A8A]">
              Effective Date: {EFFECTIVE_DATE}
            </p>
            <h1 className="text-3xl sm:text-4xl font-serif font-semibold text-[#1C1917]">
              Terms of Service
            </h1>
            <p className="text-sm sm:text-base text-[#57534E] leading-relaxed">
              By accessing or using the <strong>NLFBC - School of Ministry</strong> Learning
              Management System (LMS), you agree to abide by these Terms of Service and all
              policies set by New Life Fundamental Baptist Church — School of Ministry.
            </p>
          </header>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              1. Account Registration &amp; Enrollment Approval
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[#57534E] leading-relaxed">
              <li>
                Access requires a valid, verified Google account. New student registrations remain
                in a pending state until reviewed and approved by a school instructor or
                administrator.
              </li>
              <li>
                Course enrollment requests also require instructor or administrator approval before
                lesson downloads, Google Drive resources, class recordings, and assignment uploads
                are unlocked.
              </li>
              <li>
                You are responsible for maintaining the security of your Google account and
                forgetting shared or public devices after signing out.
              </li>
            </ul>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              2. Acceptable Use &amp; Ministry Conduct
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[#57534E] leading-relaxed">
              <li>
                All students, instructors, and administrators agree to uphold respectful, honest,
                and Christian conduct in live Google Meet sessions, submitted coursework, and
                account profiles.
              </li>
              <li>
                You may not share class Meet links, private recordings, or course study materials
                with non-enrolled individuals or post them publicly without written permission from
                the School.
              </li>
              <li>
                You may not attempt to bypass enrollment gates, impersonate faculty or other
                students, or upload malicious software, spam, or unlawful content.
              </li>
            </ul>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              3. Intellectual Property &amp; Course Content
            </h2>
            <p className="text-sm text-[#57534E] leading-relaxed">
              All lectures, Google Meet recordings, syllabi, study guides, and lesson files shared
              through NLFBC - School of Ministry remain the intellectual property of the School and
              its instructors and are licensed to approved enrolled students strictly for personal
              study and ministry training. Students retain ownership of their original essays and
              assignments while granting course instructors and administrators access to review and
              grade submissions.
            </p>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              4. Third-Party Services &amp; Availability
            </h2>
            <p className="text-sm text-[#57534E] leading-relaxed">
              This LMS relies on Google Firebase and Google Workspace services (Google Meet,
              Google Calendar, and Google Drive) for authentication, database storage, live video
              conferencing, and file hosting. Service availability may depend on these providers,
              and your use of connected Google services remains subject to Google&apos;s Terms of
              Service.
            </p>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              5. Account Suspension, Modifications &amp; Disclaimer
            </h2>
            <p className="text-sm text-[#57534E] leading-relaxed">
              NLFBC - School of Ministry reserves the right to revoke course access, decline
              registrations, or suspend accounts that violate these Terms or school guidelines. The
              platform is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis
              without warranties of uninterrupted availability. We may update these Terms from time
              to time by posting an updated version on this page.
            </p>
          </section>

          <section className="space-y-3 pt-4 border-t border-[#E5DFD3]">
            <h2 className="text-xl sm:text-2xl font-serif font-semibold text-[#1C1917]">
              6. Contact
            </h2>
            <p className="text-sm text-[#57534E] leading-relaxed">
              Questions about these Terms of Service may be directed to the school administrator at{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-[#1E3A8A] hover:underline break-all"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>
      )}
    </article>
  );
};
