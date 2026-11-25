# Bible School LMS & Cloud Architecture Workbench

A custom Learning Management System (LMS) for a Bible School combining a live, role-based academic platform (authentication, course cohorts, Google Meet virtual classes, automated Drive recording retrieval, and course resource/assignment workflows) with an interactive Principal Cloud Architect Technical Specification Workbench.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and aesthetic choices were confirmed during clarification and govern this plan. Executing this plan will trigger interactive setup prompts for **Firebase** (Firestore + Auth) and **Google Workspace OAuth** (Calendar, Meet, and Drive scopes).

- **Confirmed Branding**: Generic **Bible School LMS** identity without a specific institution name.
- **Confirmed Deliverable Scope**: Working LMS prototype paired with an interactive Architecture & Technical Specification Explorer covering tech stack, Google API integration flows (with copyable TypeScript snippets), database schema blueprints, presigned storage architecture, and edge-case mitigations.
- **Confirmed Persistence & Auth**: Firebase (Firestore + Firebase Authentication) with Google Sign-In and client-side Google OAuth 2.0.
- **Confirmed Instructor Google Account Model**: Individual instructor Google accounts via OAuth 2.0 (instructors authorize Google Calendar, Meet, and Drive access in-browser, passing short-lived Bearer tokens in memory to backend API proxies without server-side redirect flows).
- **Confirmed Visual Aesthetic**: Warm editorial seminary aesthetic pairing archival parchment and limestone surfaces with deep slate ink, terracotta/lapis curatorial accents, and classic editorial typography.

> [!NOTE]
> **Provisioning Gate on Execution**: When you approve this plan, the build will first invoke the Firebase provisioning flow and the Google OAuth consent configuration for `calendar.events`, `meetings.space.created`, `meetings.space.readonly`, `drive.meet.readonly`, and `drive.file` scopes before wiring live endpoints.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Live Bible School LMS**: Provides role-aware workspaces for **Students**, **Instructors**, and **Admins** (`Admin` oversees enrollments, role assignments, and course catalog; `Instructor` schedules live Google Meet classes, syncs/attaches recordings from their Google Drive, distributes syllabi/commentaries, and grades student submissions; `Student` joins live Meet sessions, watches attached class recordings asynchronously, downloads course materials, and submits assignments).
  2. **Interactive Architecture & Technical Specification Workbench**: A dedicated specification module inside the platform delivering the complete Principal Cloud Architect deliverables—interactive tech stack breakdown, Google Workspace & Meet OAuth/API sequence explorer with live TypeScript code snippets, interactive Firestore & Relational SQL schema inspector, presigned cloud storage upload/download architecture diagram, and Google API quota/edge-case mitigation matrix.
- **Target Audience**: Bible School administrators, faculty instructors, enrolled theology students, and the engineering team implementing and extending the production platform.
- **Key Value**: Bridges production architectural rigor with a working, verifiable prototype—faculty can immediately schedule real Google Meet sessions and pull Meet recordings from Drive into course modules, while developers have an interactive, living reference of the schema, security rules, and API contracts.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Authentication & Role Routing**:
   - Users land on an academic Bible School portal showcasing active term courses, upcoming live lectures, and a clean "Sign in with Google" action (following official Google button styling).
   - First-time users receive a default `student` profile in Firestore (with PII isolated in a private subdocument); designated school admins can promote users to `instructor` or `admin` from the Administration Console.
   - An explicit **Demo Role Preview Switcher** (confined to an in-page workspace toolbar for unauthenticated/sandbox preview or admin testing, never overriding real Firestore RBAC rules) lets evaluators inspect Student, Instructor, and Admin views seamlessly while clearly indicating live vs. preview session state.
2. **Virtual Class Scheduling & Attendance (Google Meet + Calendar)**:
   - Instructors select a course module and click **Schedule Live Class**, creating a Google Calendar event with `conferenceData` (Google Meet space) and/or a Meet v2 space via their OAuth token, persisting `meetUri`, `meetSpaceName`, and `calendarEventId` on the Firestore `sessions` document.
   - Students see upcoming sessions on their Course Overview and click **Join Google Meet** directly from the session row.
3. **Automated Class Recording Retrieval & Attachment**:
   - After a class concludes, instructors click **Sync Meet Recording** (or run the automated Drive/Meet polling check) inside the session panel.
   - The backend proxy queries Google Meet `conferenceRecords` and Google Drive (`drive.meet.readonly` / `mimeType='video/mp4'` matched by Meet space code, event title, and session time window), attaches the verified `driveFileId`, `webViewLink`, and `duration` to the Firestore `sessions/{sessionId}/recordings` record, and unlocks asynchronous playback in the Student module view.
4. **Resource Distribution & Assignment Submissions**:
   - Instructors upload course materials (PDF commentaries, Greek/Hebrew lexicons, lecture slides) to protected storage/Drive with signed download access and attach them to modules.
   - Students upload assignment deliverables (essays, exegesis papers) with real-time upload status, file validation, and instructor grading feedback.
5. **Architecture Specification Workbench**:
   - Accessible from the primary navigation (`Architecture`), structured into 5 modular tabs matching every requested deliverable: *Tech Stack*, *Google Meet & Drive APIs*, *Database Schema*, *Storage & Presigned URLs*, and *Quota & Edge Cases*.

### Visual Identity & Theme

- **Aesthetic Direction**: Warm editorial seminary inspired by archival manuscripts, university presses, and museum monographs—intellectual rigor without sterile SaaS clutter.
- **Color Palette (60-30-10 Discipline)**:
  - *60% Dominant Neutral Canvas*: Archival Warm Paper (`#FBF9F5`) with secondary reading surfaces in soft parchment (`#F5F1E8`).
  - *30% Structural Surfaces*: Warm limestone dividers (`#E5DFD3`), deep slate ink (`#1E293B`) for primary typography, muted stone (`#57534E`) for captions and metadata.
  - *10% Curatorial Accents*: Deep Lapis (`#1E3A8A`) for primary CTAs and active tabs, Terracotta (`#9A3412`) for live session/warning callouts, and Forest Ink (`#14532D`) paired with explicit text labels for completed/verified states.
- **Typography & Hierarchy (2+1 Rule)**:
  - *Display & Headings*: `Cormorant Garamond` (SemiBold 600) for institutional titles, course headers, and editorial section numbers (`01. Hermeneutics & Exegesis`).
  - *Body Prose & UI*: `Plus Jakarta Sans` (Regular 400 / SemiBold 600) for clean readability across course syllabi, tables, and controls.
  - *Code & Tabular Data*: `JetBrains Mono` with `tabular-nums` for schema fields, API endpoints, timestamps, and enrollment metrics.
- **Layout & Component Discipline**:
  - **Strict 3-Zone Top Bar**: Single-line wordmark (`Bible School LMS`), 4 concise text nav links (`Courses`, `Live Classes`, `Resources`, `Architecture`), and 1 primary action (`Sign In` / user account button).
  - **Zero-Pill Metadata**: Dates, instructor names, credit hours, and recording statuses render as clean unboxed text separated by `·` rather than pill badges.
  - **Whitespace Over Nested Cards**: Generous margins (`2rem–3rem`) and `1px` warm limestone hairline borders instead of thick colored left accent stripes or nested card boxes.
  - **Bespoke Visual Assets**: Custom editorial illustrations generated upfront for the hero banner and flagship course thumbnails (Biblical Hermeneutics, Old Testament Survey, New Testament Greek) with resilient CSS fallback containers.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Individual Instructor OAuth 2.0 (Client-Obtained Token Passed via Bearer Header) vs. Domain-Wide Service Account**
  - *Chosen Approach*: Client-side Google OAuth 2.0 via Firebase `GoogleAuthProvider` requesting minimal Calendar, Meet, and Drive scopes, cached strictly in memory (never `localStorage`) and forwarded to Express API routes via `Authorization: Bearer <token>`.
  - *Why*: Matches the Bible School's individual instructor account model without requiring Google Workspace Super Admin domain-wide delegation keys, and avoids ephemeral preview URL `redirect_uri_mismatch` failures.
  - *Trade-Off*: Instructors must have an active session to trigger Meet creation or Drive recording sync; mitigated by persisting `conferenceRecordId` and `driveFileId` in Firestore immediately upon sync so students never need instructor OAuth tokens to watch attached recordings.

- **Decision 2: Firestore Hybrid Subcollection Model with Strict PII Isolation vs. Flat Collections**
  - *Chosen Approach*: Split user profiles into `users/{uid}` (public display name, role, bio) and `users/{uid}/private/info` (email, phone), with `courses/{courseId}/modules`, `sessions`, `resources`, and `submissions` modeled with explicit relational IDs and server-timestamp validation.
  - *Why*: Prevents PII exposure across student cohorts, enforces zero-trust Firestore Security Rules (RBAC role fields cannot be self-elevated by students), and enables real-time `onSnapshot` updates for live class status and newly synced recordings.
  - *Trade-Off*: No native SQL joins; mitigated by denormalizing lightweight summary metadata (`courseTitle`, `instructorName`) on session documents and documenting the equivalent normalized PostgreSQL DDL side-by-side inside the Architecture Workbench.

- **Decision 3: Multi-Signal Meet Recording Matching (Meet `conferenceRecords` API + Drive Query Fallback)**
  - *Chosen Approach*: When syncing a class recording, query Meet REST API v2 `conferenceRecords` filtered by `space.name` to retrieve exact `recordings` resources (and their `driveDestination.file`), falling back to a scoped Drive v3 query (`drive.meet.readonly`) matching meeting code and session time window.
  - *Why*: Google Meet takes 5–30 minutes post-call to transcode and write MP4s into the host's "Meet Recordings" Drive folder; matching by Meet `space` and `conferenceRecord` eliminates false positives when an instructor teaches back-to-back courses.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### System Architecture & Component Diagram

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER (React 19 + Vite)                    │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │  Auth & OAuth Layer  │  │  Bible School LMS    │  │ Architecture     │  │
│  │  • Firebase Auth     │  │  • Course Catalog    │  │ Spec Workbench   │  │
│  │  • In-memory OAuth   │  │  • Meet Scheduler    │  │ • Tech Stack     │  │
│  │    Access Token      │  │  • Recording Player  │  │ • API Flows      │  │
│  │  • RBAC Context      │  │  • Resource/Submit   │  │ • Schema / Edge  │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └──────────────────┘  │
└─────────────┼─────────────────────────┼────────────────────────────────────┘
              │                         │ HTTPS + Authorization: Bearer <token>
              ▼                         ▼
┌──────────────────────────┐  ┌──────────────────────────────────────────────┐
│  FIREBASE CLOUD          │  │  EXPRESS API PROXY SERVER (server.ts)        │
│  • Firestore Database    │  │  • /api/meet/schedule (Calendar + Meet v2)   │
│    - users / private     │  │  • /api/meet/sync-recording (ConferenceRec)  │
│    - courses / sessions  │  │  • /api/storage/presign (Signed Upload/Get)  │
│    - resources / submits │  │  • /api/drive/files (Scoped Drive Metadata)  │
│  • Zero-Trust Rules      │  └──────────────────────┬───────────────────────┘
└──────────────────────────┘                         │
                                                     ▼
                              ┌──────────────────────────────────────────────┐
                              │  GOOGLE WORKSPACE & CLOUD APIS               │
                              │  • Calendar v3 (conferenceData Meet links)   │
                              │  • Meet v2 (spaces, conferenceRecords)       │
                              │  • Drive v3 (drive.meet.readonly, files)     │
                              │  • Cloud Storage (Presigned PUT/GET URLs)    │
                              └──────────────────────────────────────────────┘
```

### Data Model & RBAC Security Boundaries

| Entity / Collection | Purpose & Key Relationships | Access & Mutation Policy |
| :--- | :--- | :--- |
| `users/{uid}` | Public faculty/student profile (`displayName`, `role`, `department`, `createdAt`) | Read by signed-in cohort; role upgrades strictly gated to `admin` |
| `users/{uid}/private/info` | Isolated PII (`email`, `phone`, `studentIdNumber`) | Strictly owner or `admin` only (prevents cohort PII scraping) |
| `courses/{courseId}` | Course catalog (`code`, `title`, `term`, `instructorId`, `enrollmentCount`) | Public/signed-in catalog read; write by owning `instructor` or `admin` |
| `enrollments/{enrollmentId}` | Maps `studentId` ↔ `courseId` with `status` (`active`, `completed`) | Student reads own; `instructor`/`admin` manages roster |
| `sessions/{sessionId}` | Scheduled virtual class (`courseId`, `scheduledStart`, `meetUri`, `meetSpaceName`, `calendarEventId`, `recordingStatus`) | Enrolled students & course instructor read; instructor/admin creates & updates |
| `recordings/{recordingId}` | Attached Meet video (`sessionId`, `courseId`, `driveFileId`, `conferenceRecordId`, `playbackUrl`, `durationSeconds`, `syncedAt`) | Enrolled students & instructor read; instructor/admin attaches via sync |
| `resources/{resourceId}` | Instructor learning materials (`courseId`, `moduleTitle`, `fileName`, `mimeType`, `storageKey`, `accessScope`) | Enrolled students read/download; course instructor uploads/manages |
| `submissions/{submissionId}` | Student assignment uploads (`courseId`, `sessionId`, `studentId`, `fileName`, `storageKey`, `grade`, `feedback`) | Student creates/reads own; course instructor reads & grades |

### Interactive Component & State Mapping

- **Auth & Role Guard (`FirebaseProvider`)**: Initializes Firebase, runs `getDocFromServer` health check, subscribes to `onAuthStateChanged`, caches Google OAuth access token strictly in memory, and exposes `needsWorkspaceAuth` prompts whenever an instructor initiates a Calendar/Meet/Drive call without an active OAuth token.
- **Course & Module Workspace**: Filters courses by active term and role (`My Enrolled Courses` vs. `Teaching` vs. `All Courses`), loading sub-views for Sessions, Recordings, Resources, and Assignments with explicit loading, empty, and permission-error states (`handleFirestoreError`).
- **Google Meet Class Scheduler Modal (Instructor/Admin)**: Validates title, start/end timestamps, and course ownership; dispatches `POST /api/meet/schedule` with Bearer token to create a Meet space + Calendar event, then writes the resulting `meetUri` and `meetSpaceName` to Firestore `sessions`.
- **Recording Sync Drawer (Instructor)**: Calls `POST /api/meet/sync-recording` with the session's `meetSpaceName`, inspects `conferenceRecords` and Drive Meet recordings, displays matched recording metadata (duration, timestamp, Drive file ID), and commits the `recordings` document to Firestore upon confirmation.
- **Protected Resource & Assignment Uploader**: Requests a short-lived signed upload/download URL (or scoped Drive upload), validates file size/MIME type (`application/pdf`, `video/mp4`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`), shows progress state, and records immutable metadata in Firestore.
- **Destructive Action Confirmation Modals**: Any mutation or deletion of Google Calendar events or Drive/Course files requires an explicit custom confirmation dialog before executing the Workspace API call.
- **Interactive Architecture Specification Workbench**:
  - *Section 1 — Tech Stack*: Interactive layer comparison cards with rationale for React/TypeScript, Express proxy, Firebase/Firestore, and GCS/Drive hybrid storage.
  - *Section 2 — Google Workspace & Meet API Strategy*: Interactive flow stepper (OAuth 2.0 vs. Service Account comparison, exact scopes, Calendar + Meet v2 creation payload, Meet `conferenceRecords` + Drive v3 webhook/polling sequence) with copyable TypeScript snippets.
  - *Section 3 — Database Schema*: Toggle between the **Firestore NoSQL Schema** (live blueprint) and the **Relational PostgreSQL DDL** (`Users`, `Courses`, `Sessions`, `Resources`, `Recordings`, `Submissions`) with interactive entity relationship highlights.
  - *Section 4 — File Upload & Storage Architecture*: Interactive presigned URL flow simulator showing 15-minute PUT upload URLs, IAM isolation, and watermarked/short-lived GET playback URLs for proprietary Bible School materials.
  - *Section 5 — Critical Edge Cases & Quotas*: Searchable matrix of Google Workspace quotas (Calendar 1M queries/day & per-user rate limits, Meet recording processing lag, OAuth token expiration, Drive webhook channel renewal every 7 days) and concrete exponential-backoff + idempotency mitigations.
