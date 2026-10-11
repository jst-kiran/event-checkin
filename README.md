# Event Check-in

Registration verification and check-in for a live event, plus an organizer dashboard.

- **Desk (`/` and `/checkin`)** — an organizer types an attendee's email. If it is in the event's
  Google Sheet, the screen shows **Registration Verified** with Full Name, Enrollment Number,
  Semester, Course and Specialization, and the person is **checked in** (once — a second scan says
  when they were checked in).
- **Dashboard (`/admin`)** — sign in to see every registration with its check-in status and time,
  search and filter, **manually check in** anyone on the list, and **add walk-ins** who are not
  registered. Manual check-ins are highlighted **amber** and walk-ins **purple** — on the dashboard
  and in the spreadsheet.

React + Vite + Tailwind on the front, Vercel serverless functions on the back, Google Sheets as
the store — no database and no separate backend to keep alive.

> This project was previously used for a check-in / lunch / teams event. Lunch, project upload,
> teams and the old stats endpoints are **removed** — see [Removed features](#9-removed-features).
> Their code is in git history (commit `892276c`).

---

## Table of contents

1. [How it works](#1-how-it-works)
2. [Google setup](#2-google-setup)
3. [Environment variables](#3-environment-variables)
4. [Checking the sheet before the event](#4-checking-the-sheet-before-the-event)
5. [Local development](#5-local-development)
6. [Deploying to Vercel](#6-deploying-to-vercel)
7. [API reference](#7-api-reference)
8. [Data rules: matching, duplicates, bad rows](#8-data-rules)
9. [Removed features](#9-removed-features)
10. [Security](#10-security)
11. [Testing](#11-testing)
12. [Using this for a future event](#12-using-this-for-a-future-event)
13. [Troubleshooting](#13-troubleshooting)
14. [Project structure](#14-project-structure)

---

## 1. How it works

```
 Registration spreadsheet (Google Sheets)
 ├── "Form responses 1"  ← registrations. READ ONLY — the app never writes here.
 └── "CheckIns"          ← one row per check-in. The ONLY tab the app writes.
                           Created automatically on the first check-in.

 Desk  /checkin ── POST /api/verify ──▶ read registrations (cached ≤ 60 s)
                                        match email → append a "Desk" row to CheckIns
 Admin /admin   ── GET  /api/admin/attendees ──▶ registrations + CheckIns, merged
                ── POST /api/admin/attendees ──▶ "Manual" or "Walk-in" row to CheckIns
```

- **Registrations are read-only.** Reads use a `spreadsheets.readonly` token. Every write goes
  through three guarded functions that refuse any tab except `CheckIns` (and refuse everything if
  `CHECKIN_SHEET_NAME` were ever set to the registration tab's name).
- **One check-in per person.** Requests for the same email are queued; if two devices still race,
  the later row marks itself `Duplicate (ignored)` and is never counted. Nothing is deleted.
- **Fresh data.** Registrations are cached for `REGISTRATION_CACHE_SECONDS` (default 60), so a new
  form response is verifiable within a minute. A failed refresh is never answered from stale data.
- **Failure is never "not found".** If the sheet can't be read, the desk shows *Verification
  Unavailable*; if the check-in can't be saved, *Check-in Not Saved — try again*.
- **Minimal disclosure.** The desk returns only the five fields plus the check-in time. Phone
  numbers are never read into a record, never written to `CheckIns`, never sent anywhere.

`CheckIns` columns: `Timestamp | E-mail address | Full Name | Enrollment Number | Semester | Course |
Specialization | Method | Checked In By | Status`. **Method** is `Desk`, `Manual` or `Walk-in`; a row
typed into the tab by hand with no method counts as `Manual`. Conditional formatting colours
`Manual` rows amber, `Walk-in` rows purple and ignored duplicates grey.

---

## 2. Google setup

1. In <https://console.cloud.google.com>, enable the **Google Sheets API** for your project and
   create a **service account** with a **JSON key** (keep the file private; never commit it). If
   you reuse the previous event's service account, this is already done.
2. **Share the registration spreadsheet with the service account's `client_email` as _Editor_.**
   Editor is needed to create and fill the `CheckIns` tab.
3. **Optional extra safety — protect the registration tab:** right-click the `Form responses 1` tab
   → **Protect sheet** → **Set permissions** → **Only you** → Done. Then even the service account
   cannot change it. Form responses should keep arriving (the form writes on your behalf); check
   that the next new response still appears, and remove the protection if it doesn't — the app's
   own write guard protects the tab either way.
4. Set **General access** to **Restricted** so only invited people (and the service account) can
   open the sheet — it holds students' contact details.

---

## 3. Environment variables

Copy [`.env.example`](.env.example) to `.env` for local development; set the same keys in
**Vercel → Project → Settings → Environment Variables** for production.

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | yes | `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | yes | `private_key` from the JSON key |
| `REGISTRATION_SHEET_ID` | yes | The spreadsheet ID, or its full URL |
| `REGISTRATION_SHEET_NAME` | yes | The registration tab, e.g. `Form responses 1` |
| `ADMIN_EMAIL` | yes (dashboard) | Organizer login |
| `ADMIN_PASSWORD` | yes (dashboard) | Organizer login |
| `SESSION_SECRET` | yes (dashboard) | Signs the login cookie; ≥ 16 characters |
| `CHECKIN_SHEET_NAME` | no | Check-in tab, default `CheckIns` |
| `REGISTRATION_CACHE_SECONDS` | no | 0–600, default 60 |
| `EVENT_TIMEZONE` | no | Check-in timestamps, default `Asia/Kolkata` |
| `VITE_EVENT_DATE`, `VITE_EVENT_LOCATION` | no | Public text shown under the desk card |

`REGISTRATION_SHEET_ID` / `REGISTRATION_SHEET_NAME` replace the old `GOOGLE_SHEET_ID`, which is
**no longer read** — a deployment that only has the old variable fails safely instead of quietly
using the previous event's sheet.

The private key is multi-line: in `.env` wrap it in double quotes with literal `\n` escapes; in the
Vercel dashboard paste it exactly as in the JSON file. **Never prefix a server variable with
`VITE_`** — Vite ships every `VITE_*` value to the browser.

---

## 4. Checking the sheet before the event

```bash
npm run check:registrations
```

Reads the registration tab exactly the way the deployed app does and prints **row numbers and counts
only** — column mapping, rejected rows, duplicates, verifiable registrations. It writes nothing.

---

## 5. Local development

```bash
npm install
cp .env.example .env     # then fill it in
npm run dev              # http://localhost:5173/checkin and /admin
npm test                 # automated tests, no network required
npm run build            # production build into dist/
```

`npm run dev` serves the React app *and* runs the `/api` functions through a small Vite plugin
([`dev/vite-api-plugin.js`](dev/vite-api-plugin.js)), so the same code runs locally and on Vercel.
**Local check-ins are real** — they are written to the real `CheckIns` tab. Delete test rows from
that tab before the event (or test with an email you then remove).

---

## 6. Deploying to Vercel

1. Set every required variable from section 3 for **Production** (and Preview if you use it).
   Remove `GOOGLE_SHEET_ID` and `VITE_EBOOKS_URL` — nothing reads them.
2. Share and protect the spreadsheet (section 2).
3. Deploy (`git push` to the connected branch, or **Redeploy**). New variables only apply to new
   deployments.
4. Open `/checkin`, verify a known email; open `/admin`, sign in and confirm the row shows
   *Checked in*.

The deployment has **five** serverless functions (`/api/verify` and four under `/api/admin`), well
under the Hobby plan's limit of 12. [`vercel.json`](vercel.json) rewrites non-`/api` paths to the
SPA and marks every `/api` response `no-store`.

---

## 7. API reference

### `POST /api/verify` — the desk

Request `{ "email": "student@example.com" }`.

| HTTP | `status` | Meaning |
|---|---|---|
| 200 | `REGISTRATION_VERIFIED` | `attendee` (5 fields) + `checkIn: { status: CHECKED_IN \| ALREADY_CHECKED_IN, checkedInAt, method }` |
| 404 | `REGISTRATION_NOT_FOUND` | *Registration Not Found — Please check the email address or contact the event organizers.* |
| 409 | `DUPLICATE_REGISTRATION` | The email is on rows describing different people — no details, no check-in |
| 400 | `EMAIL_REQUIRED` / `INVALID_EMAIL` / `INVALID_REQUEST` | Bad input |
| 429 | `RATE_LIMITED` | > 30 requests a minute from one client |
| 503 | `REGISTRATION_DATA_UNAVAILABLE` | The registration sheet could not be read or validated |
| 503 | `CHECK_IN_UNAVAILABLE` | Registered, but the check-in could not be saved — try again |

### Organizer endpoints (signed-in only; cookie is HttpOnly, SameSite=Strict)

| Route | Purpose |
|---|---|
| `POST /api/admin/login` | `{ email, password }` → session cookie (8 attempts / 15 min) |
| `POST /api/admin/logout` | Clears the cookie |
| `GET /api/admin/session` | Is this browser signed in? |
| `GET /api/admin/attendees` | Every registration with `checkedIn`, `checkedInAt`, `method`, `checkedInBy`; walk-ins; `summary` counts; sheet health (rejected / duplicate rows by number). No phone numbers. |
| `POST /api/admin/attendees` | `{ action: "check-in", email }` — manual check-in of a registered email (404 if not registered) |
|  | `{ action: "walk-in", fullName, email, enrollmentNumber?, semester?, course?, specialization? }` — check in someone not registered (409 `ALREADY_REGISTERED` if they are) |

All other old endpoints (`/api/checkin`, `/api/lunch`, `/api/project-upload`, `/api/teams`,
`/api/admin/stats`, `/api/admin/checkins`, `/api/admin/teams`, `/api/admin/projects`,
`/api/admin/project-settings`) no longer exist: **404** for every method.

---

## 8. Data rules

Registration columns are found by header name, ignoring case, spaces, non-breaking spaces and
punctuation, in any position.

| Column | Required | Used for |
|---|---|---|
| `E-mail address` | yes | Matching |
| `Full Name`, `Enrollment Number`, `Semester`, `Course`, `Specialization` | yes | Shown and copied into `CheckIns` |
| `Timestamp` | no | Not used |
| `Phone number` | no | **Never read, written or returned** |

- **Matching** is exact on the normalized address (trimmed, lower-cased, invisible characters removed).
- **Rejected rows** (missing or malformed email) can't be found at the desk; the dashboard lists their
  row numbers. Fix the email in the sheet, or add the person as a walk-in.
- **Repeat submissions** with identical details count once.
- **Same person, reworded details** (same email, Full Name and Enrollment Number): one person; every
  distinct value is shown, e.g. *ECE / Btech ECE*.
- **Conflicting duplicates** (same email, different Full Name or Enrollment Number): the desk tells
  them to see an organizer; an organizer can check them in manually from the dashboard.
- **Malformed sheet** (missing required column, two email-like columns, empty tab, mostly invalid
  emails) → *Verification Unavailable*, never a false *Not Found*.

---

## 9. Removed features

Lunch verification and food preference, project upload, team generation/shuffling, project
management and the old stats/check-in-log endpoints — removed from the UI and the server (404).
Their routes now redirect to `/checkin`.

---

## 10. Security

- **Registration tab is never written**: read-only token for reads; a code-level guard on every
  write; optionally a Google Sheets protected range on top.
- **Secrets stay on the server**: credentials, sheet ID and admin password live in non-`VITE_`
  variables. The browser bundle contains only `/api/...` paths.
- **Minimum disclosure**: the public desk returns one person's five fields and check-in time. The
  dashboard (signed-in only) shows emails but never phone numbers.
- **Admin sessions**: constant-time credential check, HMAC-signed HttpOnly SameSite=Strict cookie,
  12-hour expiry, login rate-limited.
- **Formula-safe writes**: rows are written as RAW values, so a name like `=HYPERLINK(...)` stays text.
- **No internals in errors**: causes are logged server-side; browsers get fixed messages.
- **Keep the sheet private** (General access: Restricted) and **never commit registration data** —
  `.gitignore` excludes `*.csv`, `*.xlsx` and `data/`.

---

## 11. Testing

```bash
npm test
```

Node's built-in test runner against a **fictional** fixture through an in-memory fake of the Sheets
client that refuses any write to the registration tab — no network, no real attendee data. Covers:
header normalization; matching; not-found wording; bad input; duplicates; malformed sheets and
outages (503, never 404); cache behaviour; desk check-in, repeat scans and same-moment races; tab
creation with highlight rules; admin login, list, manual check-in, walk-ins and validation; no phone
numbers anywhere; read-only scope for reads; the write guard; removed endpoints returning 404; five
serverless functions; and source-level guards that nothing ships secrets to the browser.

---

## 12. Using this for a future event

1. Share the new spreadsheet with the service account (Editor) and protect its form tab.
2. Set `REGISTRATION_SHEET_ID` and `REGISTRATION_SHEET_NAME`.
3. If the form's columns differ, adjust `COLUMNS` in [`api/_lib/registrations.js`](api/_lib/registrations.js)
   and the fields in [`src/utils/messages.js`](src/utils/messages.js).
4. `npm run check:registrations`, then redeploy.

---

## 13. Troubleshooting

The Vercel function log names the cause (`[api/verify] …` or `[api/admin/attendees] …`):

| Log says | Fix |
|---|---|
| `Missing: REGISTRATION_SHEET_ID` | Set the variable and redeploy |
| `GET failed (HTTP 403)` | Share the sheet with the service account |
| `POST failed (HTTP 403) — needs Editor access` | Change the service account to **Editor** |
| `HTTP 404 — spreadsheet not found` | Check `REGISTRATION_SHEET_ID` |
| `HTTP 400 … tab name` | `REGISTRATION_SHEET_NAME` doesn't match the tab exactly |
| `Required column(s) not found` | A registration column was renamed or deleted |
| `Refusing to write …` | `CHECKIN_SHEET_NAME` points at the wrong tab |
| `Could not sign with GOOGLE_PRIVATE_KEY` | The key was pasted incompletely |
| Admin login says "not configured" | Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` |

---

## 14. Project structure

```
api/
  verify.js                    POST — desk: verify + check in
  admin/login.js, logout.js, session.js
  admin/attendees.js           GET list · POST manual check-in / walk-in
  _lib/
    registrations.js           registration parsing, matching, duplicates, cache (read-only)
    checkins.js                CheckIns tab: create, append once per email, race handling
    googleSheets.js            Sheets client: read-only reads, guarded writes
    auth.js                    signed-cookie sessions
    normalize.js, responses.js, rateLimit.js, time.js
scripts/check-registration-sheet.js   read-only pre-event sheet report
src/
  pages/CheckIn.jsx            the desk
  pages/AdminLogin.jsx, AdminDashboard.jsx
  components/                  DeskLayout, AdminLayout, StatusPanel, StatCard, …
  hooks/useVerification.js     form → request → result state machine
  utils/messages.js            status → wording; displayed fields
dev/                           local-only: .env loader and Vite /api plugin
tests/                         node --test suites, fixture and fakes
```
