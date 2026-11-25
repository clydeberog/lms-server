# Bible School LMS — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Zero Self-Elevation**: A user registering at `/users/{uid}` may ONLY create a profile with `role == 'student'` (unless already a verified admin). Users cannot mutate their own `role` field on update.
2. **Strict PII Isolation**: User email addresses and phone numbers live in `/users/{uid}/private/info` and are strictly readable ONLY by the document owner or a verified admin. No peer student can read another student's PII.
3. **Enrollment-Gated Course Access (Master Gate)**: A student can ONLY read `/courses/{courseId}`, `/sessions`, `/recordings`, and `/resources` if an active `/courses/{courseId}/members/{uid}` document exists. Revoking a member immediately cuts off subcollection access.
4. **Verified Pre-Enrollment Claim**: A student may create `/courses/{courseId}/members/{uid}` ONLY when a matching `/enrollments/{enrollmentId}` document exists whose `memberEmail` matches their verified `request.auth.token.email`, `courseId` matches the path, and `status != 'revoked'`.
5. **Immutable Ownership & Temporal Integrity**: `createdAt`, `courseId`, `instructorUid`, and `studentUid` cannot be modified after creation. All server timestamps (`createdAt`, `updatedAt`) MUST equal `request.time`.
6. **Submission Privacy & Terminal Lock**: Students may only create/read their own `/submissions/{submissionId}` documents and cannot edit `grade`, `feedback`, or `status`. Once a submission reaches terminal state `status == 'graded'`, students cannot mutate it; only the course instructor or an admin may update grading fields.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Privilege Escalation on Registration**: Student creates `/users/u1` with `{ role: "admin" }`. → `PERMISSION_DENIED`.
2. **Self-Role Upgrade on Update**: Student updates `/users/u1` with `{ role: "instructor" }`. → `PERMISSION_DENIED`.
3. **PII Cross-Read**: Student `u2` reads `/users/u1/private/info`. → `PERMISSION_DENIED`.
4. **Unverified Admin Email Spoof**: Unverified token (`email_verified: false`) matching bootstrap admin email reads `/users`. → `PERMISSION_DENIED`.
5. **Shadow Ghost Field Injection**: Instructor creates `/courses/c1` including unauthorized field `isFeatured: true`. → `PERMISSION_DENIED`.
6. **ID Poisoning**: Attacker writes `/courses/../../evil$id` or 200-char doc ID. → `PERMISSION_DENIED`.
7. **Unauthorized Self-Enrollment**: Student creates `/courses/c1/members/u2` referencing a non-existent or someone else's `enrollmentId`. → `PERMISSION_DENIED`.
8. **Orphaned Session Creation**: Instructor creates `/courses/nonexistent/sessions/s1`. → `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: Instructor creates `/courses/c1` with backdated client `createdAt`. → `PERMISSION_DENIED`.
10. **Student Self-Grading**: Student updates `/courses/c1/submissions/sub1` with `{ grade: "A+", status: "graded" }`. → `PERMISSION_DENIED`.
11. **Value Poisoning on Allowed Key**: Instructor updates `/courses/c1` setting `title` to a 5,000-character string or integer. → `PERMISSION_DENIED`.
12. **Blanket Enrollment Scraping**: Student executes unfiltered `list` query on `/enrollments` without matching `memberEmail` / `memberUid`. → `PERMISSION_DENIED`.
