# Event Check-In

A check-in, lunch and organizer dashboard system for a live event. React + Vite on the front,
Vercel serverless functions on the back, Google Sheets as the operational store — no database, no
Google Apps Script, no separate backend to keep alive.

---

## Table of contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Why there is no Apps Script](#3-why-there-is-no-apps-script)
4. [Why registrations are frozen](#4-why-registrations-are-frozen)
5. [Google Sheet setup](#5-google-sheet-setup)
6. [Google Cloud and service account setup](#6-google-cloud-and-service-account-setup)
7. [Environment variables](#7-environment-variables)
8. [Generating the registration snapshot](#8-generating-the-registration-snapshot)
9. [Local development](#9-local-development)
10. [Deploying to Vercel](#10-deploying-to-vercel)
11. [Admin authentication](#11-admin-authentication)
12. [Workflows: check-in, lunch, teams](#12-workflows)
13. [API reference](#13-api-reference)
14. [Concurrency and duplicate protection](#14-concurrency-and-duplicate-protection)
15. [Security](#15-security)
16. [Event-day operational procedure](#16-event-day-operational-procedure)
17. [Testing](#17-testing)
18. [Troubleshooting](#18-troubleshooting)
19. [Project structure](#19-project-structure)

---

## 1. Overview

Five screens:

| Route | Who uses it | What it does |
|---|---|---|
| `/checkin` | Attendees, at the entry desk | Verifies an email against the guest list and records arrival |
| `/lunch` | Attendees, at the lunch counter | Confirms the person checked in, records the meal, shows their preference |
| `/admin/login` | Organizers | Server-verified sign-in |
| `/admin` | Organizers | Live counts and the check-in log |
| `/admin/teams` | Organizers | Randomly divides checked-in attendees into teams |

The attendee screens are the ones under time pressure, so they are deliberately plain: one field,
one button, one unmistakable result, and focus returns to the field automatically so the operator
can start the next person without reaching for the mouse.

---

## 2. Architecture

```
                    ┌──────────────────────┐
                    │    Google Sheets     │
                    │                      │
                    │  Registrations       │  ← read ONCE, before the event
                    │  CheckIn             │  ← live, read and written
                    │  Lunch               │  ← live, read and written
                    └──────────┬───────────┘
                               │
                     ONE-TIME SNAPSHOT
                    (npm run snapshot)
                               │
                               ▼
                    ┌──────────────────────┐
                    │ data/registrations   │
                    │        .json         │   frozen guest list, committed
                    └──────────┬───────────┘
                               │
┌────────────────┐      ┌──────▼───────────┐
│ React + Vite   │─────▶│ Vercel Functions │
│                │      │                  │
│ /checkin       │      │ /api/checkin     │
│ /lunch         │      │ /api/lunch       │
│ /admin         │      │ /api/admin/*     │
│ /admin/teams   │      │                  │
└────────────────┘      └──────┬───────────┘
                               │ Google Sheets REST API
                               │ (service account JWT)
                               ▼
                       ┌─────────────────┐
                       │  CheckIn        │
                       │  Lunch          │
                       └─────────────────┘
```

The split that matters:

| Data | Where it lives at event time | Why |
|---|---|---|
| **Registrations** | Frozen JSON snapshot in the repo | Cannot change after RSVPs close; a Map lookup instead of a network call |
| **CheckIn** | Live Google Sheet | Changes constantly; organizers watch it in the spreadsheet |
| **Lunch** | Live Google Sheet | Same |

There is no database, no ORM, no Express server, no Redis, no separate backend host, and no
persistent Node process. Everything is either a static asset or a function that runs on request.

**Runtime dependencies: `react`, `react-dom`, `react-router-dom`, `lucide-react`.** That is the
whole list. The Google integration is written directly against the Sheets REST API using
`node:crypto` for the service-account JWT, which is about sixty lines in
[`api/_lib/googleSheets.js`](api/_lib/googleSheets.js) and avoids pulling the `googleapis` SDK into
every cold start.

---

## 3. Why there is no Apps Script

An earlier version of this system reached Google Sheets through an Apps Script web app. This one
talks to the Sheets API directly, because the bridge cost more than it gave:

- **Two deployment steps instead of one.** Editing the script was not enough — you had to remember
  *Deploy → Manage deployments → New version*, or the live `/exec` URL silently kept running the old
  code.
- **A second secret to rotate**, shared between two systems that had to agree.
- **HTML error pages instead of errors.** A misconfigured deployment returns a Google sign-in page,
  so the failure surfaces as "the JSON did not parse" rather than as what actually went wrong.
- **An extra hop** on every single check-in, with its own quota and its own latency.

Direct API access removes all four. The trade-off is losing Apps Script's `LockService`, which is
addressed in [Concurrency](#14-concurrency-and-duplicate-protection).

---

## 4. Why registrations are frozen

RSVPs close on **15 August 2026**. After that the guest list is a constant, and treating a constant
as live data costs you three things:

- **Speed.** Looking up an attendee becomes a `Map.get`, not an HTTP round trip.
- **Resilience.** If the Sheets API is slow or degraded, an unregistered email is still rejected
  instantly, and the desk keeps working for everything except the write.
- **Quota.** Google allows **60 read requests per minute per service account**. Re-reading a
  200-row guest list on every scan would spend that budget on data that cannot change.

So the guest list is read from Google exactly once, validated, and committed to the repository as
`data/registrations.json`. During the event it is immutable.

> **pandas is not involved at runtime.** You may use pandas (or anything else) to clean the export
> before generating the snapshot — see [section 8](#8-generating-the-registration-snapshot). The
> deployed application has no Python in it and never builds a DataFrame per request.

---

## 5. Google Sheet setup

One spreadsheet, three tabs.

### `Registrations` — read once, never written

Your existing RSVP data. A Google Form export already looks right. Recommended headers:

```
Timestamp | Name | Email Address | Organization/University | Designation | Phone Number | Meal Preference
```

**Column order does not matter, and neither does exact spelling.** Headers are matched by meaning,
case-insensitively, ignoring spaces and punctuation. All of these resolve to the email column:

```
Email · Email Address · E-mail · EMAIL ADDRESS · e mail · Your Work Email
```

The same applies to `Name`, `Organization`/`University`, `Designation`, `Phone` and
`Meal Preference`. The full alias list is in [`api/_lib/normalize.js`](api/_lib/normalize.js).

Only `Email` is mandatory. A missing name downgrades the greeting to "Attendee"; a missing email
means the row cannot be a person and is skipped with a warning.

**The application never writes to this tab.**

### `CheckIn` — written by the app

```
Timestamp | Email | Name | Organization | Designation | Phone | Meal Preference | Check-in Status
```

### `Lunch` — written by the app

```
Timestamp | Email | Name | Meal Preference | Lunch Status
```

For both, you can create the tab and leave it completely empty — the header row is written
automatically on the first write. If you create the headers yourself, order and spelling are again
flexible; the app locates columns by header, not by position.

`Timestamp` is written as an offset ISO string, e.g. `2026-08-20T14:45:03+05:30`. That is readable
as local wall-clock time in the spreadsheet *and* parses exactly. Set `EVENT_TIMEZONE` if your event
is not in `Asia/Kolkata`.

`Check-in Status` and `Lunch Status` hold `Checked In` / `Claimed`, or `Duplicate (ignored)` for a
row that lost a write race — see [Concurrency](#14-concurrency-and-duplicate-protection).

---

## 6. Google Cloud and service account setup

1. **Create or pick a project** at <https://console.cloud.google.com>.
2. **Enable the Google Sheets API**: *APIs & Services → Library → Google Sheets API → Enable*.
   (The Drive API is *not* needed — this app only reads and writes cells in a sheet it is given.)
3. **Create a service account**: *APIs & Services → Credentials → Create credentials → Service
   account*. No project role is required; access is granted per-spreadsheet in step 5.
4. **Create a JSON key**: open the service account → *Keys → Add key → Create new key → JSON*. This
   downloads a file containing `client_email` and `private_key`. **Treat this file as a password.**
   Do not commit it.
5. **Share the spreadsheet with the service account.** Open your spreadsheet → *Share* → paste the
   `client_email` value (it looks like `something@project-id.iam.gserviceaccount.com`) → give it
   **Editor** → Send.

Step 5 is the one people miss. Without it every request fails with a permission error, because the
service account is a separate identity from your Google account.

---

## 7. Environment variables

Copy [`.env.example`](.env.example) to `.env` for local development, and set the same keys in
**Vercel → Settings → Environment Variables** for production.

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | yes | `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | yes | `private_key` from the JSON key |
| `GOOGLE_SHEET_ID` | yes | The ID from the spreadsheet URL |
| `ADMIN_EMAIL` | yes | Organizer login |
| `ADMIN_PASSWORD` | yes | Organizer login |
| `SESSION_SECRET` | yes | Signs the admin session cookie; min 16 chars |
| `EVENT_TIMEZONE` | no | Defaults to `Asia/Kolkata` |
| `SHEET_CHECKIN` / `SHEET_LUNCH` / `SHEET_REGISTRATIONS` | no | Override tab names |
| `REGISTRATIONS_PATH` | no | Alternate snapshot file. **Local testing only** |

Generate the session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### The private key, specifically

This is the single most common setup problem. The key is a multi-line PEM block, and different
places want it differently:

- **In `.env`** — wrap it in double quotes and use literal `\n` escapes:
  ```
  GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
  ```
- **In the Vercel dashboard** — paste it exactly as it appears in the JSON file, real line breaks
  and all. The input accepts multi-line values.

Both forms are normalized at runtime (`\n` unescaped, wrapping quotes stripped, CRLF cleaned), so
paste whichever you have. If the key is malformed, the failure happens at signing time with a clear
server-side log — no request is sent to Google with a broken credential.

**Never prefix any of these with `VITE_`.** Vite inlines every `VITE_*` value into the JavaScript
it ships to browsers. Nothing in this project uses that prefix, and nothing should.

---

## 8. Generating the registration snapshot

Run this **once**, after RSVPs close, then review and commit the result.

```bash
# Straight from the Registrations tab (needs the Google variables set)
npm run snapshot

# Or from an exported CSV, if you prefer to clean it first
npm run snapshot -- --from ~/Downloads/registrations.csv

# Preview without writing anything
npm run snapshot -- --dry-run
```

The script loads `.env` itself — it runs as bare Node, not through Vite, so
nothing else would populate `process.env` for it.

### Which column is the attendee's identity

This spreadsheet has **two** email columns, because the Google Form both
auto-collected the respondent's account address (`Email Address`) and asked for
one (`Email`). They disagree on 23 of 59 rows, and only one of them is what an
attendee will type at the desk.

That choice is a snapshot-generation decision, not a runtime one, so it is
recorded in the npm script:

```jsonc
"snapshot": "node scripts/generate-registration-snapshot.js --email-column Email"
```

**This project uses `Email` — the address the attendee typed.** Plain
`npm run snapshot` therefore always makes the same choice, and the resolved
column is printed on every run so it can be checked:

```
email           "Email"   <- set explicitly by --email-column
```

Passing `--email-column` again on the command line overrides the default.
Getting this wrong is not a crash — it silently produces a snapshot in which
23 people cannot check in.

The script prints which column it resolved for each field, a count of every meal preference it
found, and then **refuses to write** if anything is wrong:

```
ERROR: Duplicate registration email(s) found:

  john@example.com (rows 2 and 47)

Two rows claim the same person, and this script will not guess which one
is real. Remove or merge the duplicates in the Registrations sheet, then
run this script again.
```

Refusing rather than repairing is deliberate. If two rows share an email, the script cannot know
which is the real attendee, and quietly picking the first would hide the problem until someone is
turned away at the door. Fixing it in the spreadsheet, before deployment, is the cheap moment.

| Condition | Result |
|---|---|
| Same email, **different people** | **Fails**, showing which fields disagree |
| Same email, **identical details** | Warns, collapses into one registration |
| Malformed email | **Fails**, naming the row |
| No email column found | **Fails**, listing the headers it saw |
| `--email-column` names a header that does not exist | **Fails** |
| No valid registrations | **Fails** |
| Row with no email | Warns, skips the row |
| Row with no name | Warns, uses "Attendee" |

The distinction in the first two rows matters. Somebody filling the form twice
is harmless — both rows describe one person, so either produces the same record
and the later one is dropped with a warning. Somebody registering their friends
under *their own* address is the dangerous case: one address cannot identify
three attendees, only one of them could ever check in or collect a meal, and
that has to be fixed in the sheet before the event. The report prints the
conflicting values side by side so the cause is obvious:

```
  shared@example.com
    rows 25 and 26 differ on: name
      row 25  name: "deepanshu moorjani"
      row 26  name: "nikhil saraf"
```

The output includes provenance so you can confirm the deployed snapshot is the one you signed off —
it is shown on the admin dashboard:

```json
{
  "snapshotVersion": "2026-08-15",
  "generatedAt": "2026-08-15T10:00:00.000Z",
  "totalRegistrations": 120,
  "attendees": [ ... ]
}
```

An existing snapshot is backed up to `data/registrations.json.<timestamp>.bak` before being
replaced.

### Optional: cleaning with pandas first

If the export needs real cleaning, do it offline and feed the result in with `--from`:

```python
import pandas as pd

df = pd.read_csv("raw-registrations.csv")
df["Email Address"] = df["Email Address"].str.strip().str.lower()
df = df.drop_duplicates(subset=["Email Address"], keep="first")
df.to_csv("clean-registrations.csv", index=False)
```

```bash
npm run snapshot -- --from clean-registrations.csv
```

The deployed application still has no Python in it.

---

## 9. Local development

```bash
npm install
cp .env.example .env     # then fill it in
npm run dev              # http://localhost:5173
npm test                 # 186 tests, no network required
npm run build            # production build into dist/
```

`npm run dev` serves the React app *and* runs the `/api` functions, via a small Vite plugin
([`dev/vite-api-plugin.js`](dev/vite-api-plugin.js)). The plugin hands each handler Node's own `req`
and `res` — exactly what Vercel hands a Node function — so the same code runs in both places with no
adapter and no second implementation. It is development tooling and never ships.

The dev server also listens on your LAN address, so you can open the check-in screen on a phone
and test what an attendee will actually hold.

You can develop most of the app without Google credentials at all: registration lookup, validation,
error handling and the whole admin auth flow work from the frozen snapshot alone. Only the actual
check-in and lunch *writes* need a real spreadsheet.

---

## 10. Deploying to Vercel

```bash
npm i -g vercel
vercel login
vercel            # preview deployment
vercel --prod     # production
```

Or import the Git repository at <https://vercel.com/new>. Vercel detects Vite automatically;
[`vercel.json`](vercel.json) supplies the rest.

**Before the first deploy, set all six required environment variables** in *Settings → Environment
Variables* (Production, Preview and Development as appropriate), then redeploy — Vercel does not
apply new variables to an existing build.

Two details in `vercel.json` that matter:

```jsonc
"functions": {
  "api/**/*.js": {
    "maxDuration": 20,
    "includeFiles": "data/**"   // ships the frozen snapshot inside each function
  }
},
"rewrites": [
  { "source": "/((?!api/).*)", "destination": "/index.html" }   // SPA fallback, API excluded
]
```

`includeFiles` is required. The snapshot is *read* at runtime rather than `import`ed, so Vercel's
dependency tracing cannot see it — without this line every lookup fails in production while working
perfectly in local dev.

The rewrite's negative lookahead is what lets `/checkin`, `/admin/teams` and friends survive a hard
refresh without swallowing `/api/*` routes.

---

## 11. Admin authentication

Sign-in posts to `/api/admin/login`, which compares the credentials against `ADMIN_EMAIL` and
`ADMIN_PASSWORD` in constant time. On success the browser receives a session cookie:

```
admin_session=<payload>.<HMAC-SHA256 signature>; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=43200
```

- **`HttpOnly`** — page JavaScript cannot read it, so an XSS bug cannot steal the session.
- **`SameSite=Strict`** — never sent on a cross-site request, which closes CSRF on every
  state-changing admin route.
- **`Secure`** — set everywhere except local http, where browsers would drop it.
- **Signed, not encrypted** — you can decode the payload, but you cannot produce a valid signature
  for one you invented. Editing `sub`, extending `exp`, or fabricating a session all fail
  verification. The signing key never leaves the server.

There is no server-side session store, because serverless instances come and go and a store would
have to be consistent across all of them. The consequences, stated plainly:

- Sessions cannot be revoked individually. Logout clears the cookie in that browser; a token copied
  off a device beforehand stays valid until it expires (12 hours).
- **Rotating `SESSION_SECRET` invalidates every outstanding session at once.** That is the
  emergency lever if a device is lost mid-event.

`SESSION_SECRET` is required. If it is missing or under 16 characters, admin login is **disabled**
and returns `NOT_CONFIGURED` — deriving a key from the admin password instead would mean a weak
password silently becomes a weak signing key.

The `/admin` routes check the session on mount and redirect to `/admin/login` if it fails, including
after a hard refresh. That controls *rendering* only. Every `/api/admin/*` route verifies the cookie
independently, so a tampered client can paint an empty dashboard shell and get no data into it.

---

## 12. Workflows

### Check-in

```
email → normalize → frozen snapshot lookup
                      ├─ not found      → 404 REGISTRATION_NOT_FOUND
                      └─ found → read CheckIn tab
                                   ├─ already present → 409 ALREADY_CHECKED_IN
                                   └─ absent → append row → reconcile
                                                ├─ we won  → 200 CHECKED_IN
                                                └─ we lost → 409 ALREADY_CHECKED_IN
```

### Lunch

```
email → normalize → frozen snapshot lookup
                      ├─ not found        → 404 REGISTRATION_NOT_FOUND
                      └─ found → CheckIn tab
                                   ├─ not checked in → 403 PLEASE_CHECK_IN_FIRST
                                   └─ checked in → Lunch tab
                                                     ├─ present → 409 ALREADY_CLAIMED
                                                     └─ absent → append → reconcile
                                                                  → 200 LUNCH_APPROVED
```

The meal preference shown at the counter comes from the frozen registration. The request body
carries an email and nothing else, so an attendee cannot upgrade their own meal.

### Team randomizer

Takes everyone currently checked in — deduplicated by email, ignoring rows marked as duplicates —
shuffles with Fisher-Yates over `crypto.randomInt`, and deals round-robin. Dealing rather than
slicing means each attendee lands in exactly one team by construction.

- 10 people into 3 teams → 4 / 3 / 3 (sizes never differ by more than one)
- 2 people into 5 teams → 2 teams of 1, not 3 empty ones
- 0 people → an empty result, not an error

The draw runs on the server against the live check-in list, so a dashboard left open for an hour
still divides the people actually in the room. **Nothing is persisted** — teams are scratch data,
and "randomize again" is supposed to give a different, equally valid answer.

---

## 13. API reference

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/checkin` | public | Check an attendee in |
| `POST` | `/api/lunch` | public | Record a lunch claim |
| `POST` | `/api/admin/login` | public | Sign in |
| `POST` | `/api/admin/logout` | public | Clear the session cookie |
| `GET` | `/api/admin/session` | cookie | Is this browser signed in? |
| `GET` | `/api/admin/stats` | cookie | Dashboard counts |
| `GET` | `/api/admin/checkins` | cookie | Deduplicated check-in log |
| `GET` | `/api/admin/teams?teams=N` | cookie | Generate a random draw |

Any other method returns `405` with an `Allow` header.

### Status codes

| Status | HTTP | Meaning |
|---|---|---|
| `CHECKED_IN` / `LUNCH_APPROVED` / `OK` | 200 | Success |
| `INVALID_REQUEST` / `INVALID_EMAIL` | 400 | Bad input, malformed JSON, or body over 8 KB |
| `INVALID_CREDENTIALS` / `UNAUTHORIZED` | 401 | Wrong password, or missing/invalid session |
| `PLEASE_CHECK_IN_FIRST` | 403 | Registered, but not entitled to lunch yet |
| `REGISTRATION_NOT_FOUND` | 404 | Not on the guest list |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP method |
| `ALREADY_CHECKED_IN` / `ALREADY_CLAIMED` | 409 | Conflicts with existing state |
| `RATE_LIMITED` | 429 | Too many requests; `Retry-After` is set |
| `INTERNAL_ERROR` | 500 | Our bug, or missing configuration |
| `NOT_CONFIGURED` / `SERVICE_UNAVAILABLE` | 503 | Admin not set up, or Google unreachable |

Example success:

```json
{
  "success": true,
  "status": "CHECKED_IN",
  "attendee": { "name": "John Doe", "email": "john@example.com", "mealPreference": "Jain Veg Meal" }
}
```

Example failure — note that no attendee object is returned, so the endpoint cannot be used to test
whether an address is on the guest list:

```json
{ "success": false, "status": "REGISTRATION_NOT_FOUND" }
```

Error responses never contain a stack trace, a Google API message, an environment variable name or a
file path. Technical detail is logged server-side and replaced with a fixed sentence.

---

## 14. Concurrency and duplicate protection

**Google Sheets is a spreadsheet, not a database.** There is no transaction, no unique constraint
and no compare-and-swap. Two operators scanning the same attendee milliseconds apart on two phones
will both read "not checked in yet". Any claim that this is impossible would be false.

Duplicates are therefore made *harmless* in three layers rather than wished away.

**1. Per-email serialization.** Requests for the same email are queued inside the process. A single
warm function instance — the common case at one desk — turns a double-tap or a two-operator
collision into a strict sequence, so the second request sees the first one's row and reports
`ALREADY_CHECKED_IN`. It never even attempts a write.

**2. Reconciliation after the write.** Appends from *different* instances can still interleave, so
after appending, the tab is re-read. Google gives every append its own row number, and the rule is
that **the lowest row number for an email wins** — a rule both racers evaluate identically, from the
same data, without communicating. The loser rewrites its own row's status cell to
`Duplicate (ignored)` and reports `ALREADY_CHECKED_IN`.

Rows are marked, never deleted: deleting a row shifts every row beneath it, which would corrupt a
concurrent writer's reconciliation. The marked row also stays as an audit trail.

**3. Deduplication on every read.** Counts, the dashboard, the check-in log and the team draw all
collapse by normalized email and skip ignored rows. Even a row typed straight into the spreadsheet
by hand cannot inflate a number or put one person on two teams.

### The residual window, stated honestly

Between one instance reading and appending, a *different* instance may append the same email. That
produces one extra row, which layer 2 marks and layer 3 ignores. The outcomes that are actually
guaranteed:

- An attendee is never counted twice.
- An attendee is never admitted twice without the desk being told.
- A meal is never handed out twice without the counter being told.

What is *not* guaranteed is that the spreadsheet contains zero extra rows — it may briefly contain a
row marked `Duplicate (ignored)`. That is the honest trade for not having a database.

### Read caching

Sheets allows 60 reads per minute per service account. Reads inside the write path are cached for 3
seconds. This cannot cause a false `ALREADY_CHECKED_IN`: a stale copy can only be *missing* recent
rows, never inventing them, and a miss leads to an append that reconciliation then checks against
fresh data. Admin reads always bypass the cache.

---

## 15. Security

**Secrets never reach the browser.** Nothing in this project uses the `VITE_` prefix. Verified
against the production build:

```bash
npm run build
grep -r "GOOGLE_PRIVATE_KEY\|SESSION_SECRET\|ADMIN_PASSWORD\|BEGIN PRIVATE KEY" dist/   # no matches
```

The only email-shaped string in the bundle is the login form's `placeholder` attribute.

**The guest list is not in the browser either.** `data/registrations.json` is read by serverless
functions only; it is never bundled or served as a static asset.

**No attendee enumeration.** There is no `GET /api/registration?email=…`. A failed check-in returns
`REGISTRATION_NOT_FOUND` with no attendee object, so the endpoint cannot confirm whether an address
is on the list. A successful one returns name, email and meal preference — what the desk screen
shows — and never a phone number or designation. The admin check-in log withholds those too.

**Input validation.** Only the expected method is accepted. Bodies are capped at 8 KB and rejected
while streaming rather than buffered. `email` must be a string — a JSON array is refused, because
`String(['a@b.com'])` is `'a@b.com'` and would otherwise pass validation. Emails are length-capped
and pattern-checked. Team counts must be all digits (`parseInt` would read `"1.5.2"` as `1`).

**Rate limiting** is a per-instance fixed window: 30/min for attendee endpoints, 8 per 15 min for
login, 120/min for admin reads. It stops the attacks this system faces — a held-down button, a
script from one machine, a burst of password guesses — and protects the Sheets read quota. It does
**not** survive a cold start and is not shared across concurrent instances, so a distributed
attacker gets a multiple of these limits. Fixing that properly would mean adding Redis, a new hard
dependency and a new failure mode for an event desk; that trade was declined deliberately.

**XSS.** React escapes all interpolated values, and the app contains no `dangerouslySetInnerHTML`.
Attendee-supplied data is never rendered as markup.

**Logging.** Errors are logged with context but the codebase never logs passwords, keys, whole
attendee datasets or phone numbers.

**Do not commit** `.env` or the service-account JSON key. Both are covered by `.gitignore`.

---

## 16. Event-day operational procedure

### Before 15 August 2026

```
Verify the Registrations tab is complete
        ↓
npm run snapshot -- --dry-run       review the column mapping and meal counts
        ↓
Resolve any duplicates it reports    in the spreadsheet, not in the JSON
        ↓
npm run snapshot                     writes data/registrations.json
        ↓
Check totalRegistrations matches your expected headcount
        ↓
git commit data/registrations.json
        ↓
vercel --prod
        ↓
Rehearse: check yourself in on the live URL, confirm the row appears in the sheet
```

### After 15 August 2026

**Do not regenerate the snapshot.** If someone genuinely must be added late, add them to the
`Registrations` tab, re-run the snapshot, review the diff, commit and redeploy — and treat it as a
change to the deployed application, not a data edit.

### On the day

| Station | URL | Notes |
|---|---|---|
| Entry desk | `/checkin` | Focus returns to the field automatically after each attendee |
| Lunch counter | `/lunch` | Shows the meal preference; requires a prior check-in |
| Organizers | `/admin` | Refresh is manual and on demand — nothing polls in the background |

Keep the spreadsheet open in a tab. It is the live record, and it stays readable and exportable if
anything else goes wrong.

**If the app becomes unavailable mid-event**, check in on paper or directly in the `CheckIn` tab
using the same column layout. Rows added by hand are picked up automatically — they are deduplicated
by email like any other row.

---

## 17. Testing

```bash
npm test
```

186 tests, no network access and no Google project required. Business logic takes an injected
`sheets` port, so the entire check-in and lunch flow — including the race conditions — runs against
an in-memory spreadsheet.

| File | Covers |
|---|---|
| `normalize.test.js` | Email and header normalization, alias matching, ragged rows |
| `registrations.test.js` | Snapshot loading, corrupt/missing files, immutability, privacy |
| `checkin.test.js` | Check-in flow, simultaneous requests, cross-instance races, sheet variations |
| `lunch.test.js` | Lunch flow, check-in prerequisite, double claims, preference integrity |
| `stats.test.js` | Counts, deduplication, derived meal categories, roster |
| `auth.test.js` | Token forgery, expiry, tampering, constant-time compare, cookie flags |
| `api.test.js` | Every route end-to-end: methods, validation, status codes, team distribution |
| `snapshot.test.js` | The generator as a real subprocess: duplicates, bad emails, CSV quirks |
| `googleSheets.test.js` | Private key formats, configuration errors, A1 column maths |
| `rateLimit.test.js` | Windows, per-client isolation, body size caps |
| `dotenv.test.js` | The local `.env` parser |

Three real bugs were found and fixed by these tests during development: a JSON array passing email
validation via string coercion, `parseInt` accepting `"1.5.2"` as a team count, and a `.env` parser
whose `\s*` swallowed newlines so an empty value consumed the following line.

---

## 18. Troubleshooting

**`REGISTRATION_NOT_FOUND` for someone who is definitely registered**
The snapshot is stale or was never generated. Check the dashboard's "Registered" card — if it says
*Snapshot not generated* or shows 0, run `npm run snapshot`, commit and redeploy.

**Every check-in returns 500, but the guest list works**
Google is not reachable. Check the function logs in Vercel. Almost always one of: the spreadsheet
was not shared with the service-account email, the Sheets API is not enabled, or `GOOGLE_PRIVATE_KEY`
lost its newlines.

**`NOT_CONFIGURED` on admin login**
`ADMIN_EMAIL`, `ADMIN_PASSWORD` or `SESSION_SECRET` is missing in that environment, or the secret is
under 16 characters. Set them and **redeploy** — new variables do not apply to an existing build.

**Login succeeds, then the dashboard bounces to login**
The cookie is being dropped. Confirm you are on `https` (the cookie is `Secure` in production), and
that you are not viewing the API through a different domain than the app.

**Works locally, fails on Vercel with a registration error**
`includeFiles: "data/**"` is missing from `vercel.json`, so the snapshot was not bundled.

**`Sheet "CheckIn" has no recognizable Email column`**
The tab has content in row 1 but nothing that reads as an email header. Either fix the header or
clear the tab completely and let the app write it.

**Counts look wrong**
All counts are unique-by-email and ignore rows marked `Duplicate (ignored)`. If the sheet shows more
rows than the dashboard counts, that is the deduplication working.

**The local dev server serves the wrong project**
If another Vite dev server is already running on port 5173, start this one elsewhere:
`npm run dev -- --port 5199 --strictPort`.

---

## 19. Project structure

```
event-checkin-new/
├── api/                                  Vercel serverless functions
│   ├── checkin.js                        POST /api/checkin
│   ├── lunch.js                          POST /api/lunch
│   ├── admin/
│   │   ├── login.js  logout.js  session.js
│   │   └── stats.js  checkins.js  teams.js
│   └── _lib/                             not routes — Vercel skips underscore dirs
│       ├── attendance.js                 check-in/lunch engine, concurrency, admin reads
│       ├── auth.js                       signed session cookies, credential check
│       ├── googleSheets.js               service-account JWT + Sheets REST API
│       ├── registrations.js              frozen snapshot service
│       ├── normalize.js                  email and header normalization
│       ├── rateLimit.js                  per-instance fixed window
│       ├── responses.js                  JSON envelopes, body parsing, error masking
│       └── time.js                       offset ISO timestamps
│
├── data/registrations.json               FROZEN guest list — committed
├── scripts/generate-registration-snapshot.js
│
├── src/                                  React app
│   ├── pages/                            CheckIn, Lunch, AdminLogin, AdminDashboard, Teams
│   ├── components/                       DeskLayout, AdminLayout, Button, Input, StatusPanel, …
│   ├── hooks/useVerification.js          shared state machine for the two desk screens
│   ├── services/api.js                   the browser's only backend surface
│   └── utils/messages.js                 status → human wording
│
├── dev/                                  local-only tooling, never shipped
│   ├── vite-api-plugin.js                runs /api handlers in the Vite dev server
│   └── loadDotEnv.js
│
├── tests/                                186 tests, no network
├── .env.example
└── vercel.json
```
