# Production QA Audit — Event Check-In System

**Audit date:** 8 August 2026
**Production URL:** https://event-checkin-five-iota.vercel.app/
**Build under test:** commit `30f47ed` (confirmed live — see §7.1)
**Auditor role:** Principal QA / production readiness review
**Source code modified during audit:** none. **Deployments performed:** none. **Commits pushed:** none.

---

## 1. Executive summary

The application's **security posture and input validation are strong** and were verified directly
against production: every admin endpoint refuses unauthenticated callers, four classes of forged
session cookie are rejected, no secret or attendee record appears in the JavaScript bundle, and the
attendee endpoints reject malformed, oversized, type-confused and unregistered input correctly.
Latency is healthy at 345–441 ms with no observed cold-start penalty.

**One confirmed P1 configuration defect** was found: the "Explore E-Books" call to action — the only
action offered to an attendee after a successful check-in — is dead in production, because
`VITE_EBOOKS_URL` was never set in Vercel. Every attendee will reach a disabled "coming soon" notice.
This is a two-minute fix and requires a redeploy.

**Three lower-severity divergences** were found where production behaves differently from what the
code and the local test suite assert — most notably the 8 KB request-body cap, which does not
operate on Vercel at all.

**The audit is materially incomplete.** Every test that requires either production admin credentials
or a write to the live Google Sheets was deliberately **not executed**, per the production-safety
rules in the brief. That includes the single highest-risk subsystem for a live event: concurrent
check-in writes. A controlled protocol to close this gap is proposed in §26.

**Verdict: 🟡 READY WITH MINOR FIXES — provisional.** See §28 for why this cannot yet be green.

---

## 2. Application under test

Event check-in and event-management system for a live event.

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, React Router, Tailwind |
| Hosting | Vercel (static frontend + serverless Node functions) |
| Storage | Google Sheets via Sheets REST API v4 |
| Auth to Google | Service account, JWT signed with `node:crypto` (no SDK) |
| Guest list | Frozen JSON snapshot committed to the repo |
| Admin auth | HMAC-SHA256 signed, HttpOnly, SameSite=Strict cookie |

## 3. Production URL

`https://event-checkin-five-iota.vercel.app/`

## 4. Test environment

| Item | Value |
|---|---|
| Target | Vercel production, region `bom1` |
| Client | curl over HTTPS from the developer workstation |
| Browser automation | **Not available** — no headless browser in this environment |
| Repository state | Working tree clean at `30f47ed`; local `.env` present but **not** used against production |
| Local suite | 223 tests (222 pass / 1 skipped) — context only, not evidence of production behaviour |

**Consequence of no browser automation:** every visual, responsive, rendering, console-error and
browser-compatibility phase is **NOT TESTED**. Those phases are reported as such rather than
inferred. Claims about rendering would be fabrication.

## 5. Test scope

**In scope and executed:** routing, SPA fallback, asset delivery, HTTP headers, secret exposure,
admin authentication/authorization boundary, session forgery resistance, attendee input validation,
method handling, payload limits, CORS posture, latency.

**In scope but blocked:** admin dashboard data, team generation, ignore list, project uploads,
auto-refresh, successful check-in, successful lunch claim, concurrency, Google Sheets failure
handling, data-integrity trace.

**Not applicable:** Phase 10 (Top 5 / project review / scoring). No such feature exists in the
codebase — see §17.

## 6. Testing methodology

1. Source inspection to build an architecture map and enumerate the real API surface.
2. Confirmation that production serves the current commit, before attributing any defect.
3. Black-box probing of production, restricted to code paths that cannot write to Google Sheets.
4. Every candidate finding re-verified before reporting. One early "finding" was a bug in the test
   harness itself and was discarded (see §25, note on false positives).

**Evidence classification used throughout:**

| Marker | Meaning |
|---|---|
| ✅ **PROD** | Verified against the live deployment |
| 📄 **CODE** | Verified by reading source only — not observed in production |
| ⛔ **BLOCKED** | Not executed, to protect production data or for lack of credentials |
| ⬜ **NOT TESTED** | Not executed for lack of tooling |
| ➖ **N/A** | Feature does not exist |

---

## 7. Architecture map (Phase 1)

### 7.1 API surface — 9 serverless functions

| Route | Method | Auth | Writes to Sheets |
|---|---|---|---|
| `/api/checkin` | POST | public | **Yes** — appends CheckIn row |
| `/api/lunch` | POST | public | **Yes** — appends Lunch row |
| `/api/admin/login` | POST | public | No |
| `/api/admin/logout` | POST | public | No |
| `/api/admin/session` | GET | cookie | No |
| `/api/admin/stats` | GET | cookie | No |
| `/api/admin/checkins` | GET | cookie | No |
| `/api/admin/teams` | GET | cookie | No |
| `/api/admin/projects` | GET | cookie | **Yes** — creates `ProjectUploads` tab + header row if absent |

`/api/admin/projects` being a read endpoint with a structural write side effect is the reason admin
testing was blocked rather than performed.

### 7.2 Frontend routes

`/` → redirect to `/checkin` · `/checkin` · `/lunch` · `/admin/login` · `/admin` (guarded) ·
`/admin/teams` (guarded) · `/admin/projects` (guarded) · `*` → redirect to `/checkin`

### 7.3 Data flow

```
Registrations sheet ──(one-time, offline)──▶ data/registrations.json  [frozen, 58 attendees]
                                                      │
                            ┌─────────────────────────┴──────────────┐
                            ▼                                        ▼
                     /api/checkin  ──▶ CheckIn sheet          /api/lunch ──▶ Lunch sheet
                            │                                        │
                            └──────────────▶ admin reads ◀───────────┘
                                                  │
                                          ProjectUploads sheet
```

### 7.4 Concurrency design (📄 CODE)

Three layers, none verified in production: per-email in-process serialization; post-append
reconciliation where the lowest row number wins and the loser self-marks `Duplicate (ignored)`;
deduplication by normalized email on every read. Residual window: two different lambda instances can
both append, producing one extra row that layer 2 marks and layer 3 ignores.

### 7.5 Caching (📄 CODE)

Write-path reads bypass cache (`maxAgeMs: 0`). Admin reads share a 5 s window. Projects has its own
5 s cache. Dashboard polls every 12 s and pauses when the tab is hidden.

---

## 8. Functional testing results

| ID | Test | Result | Evidence |
|---|---|---|---|
| TC-001 | `/` serves and redirects to check-in | ✅ PASS | 200, root div present |
| TC-002 | `/checkin` direct URL | ✅ PASS | 200, 758 B shell |
| TC-003 | `/lunch` direct URL | ✅ PASS | 200 |
| TC-004 | `/admin` direct URL | ✅ PASS | 200 (guard is client-side; data is server-guarded) |
| TC-005 | `/admin/login` direct URL | ✅ PASS | 200 |
| TC-006 | `/admin/teams` direct URL | ✅ PASS | 200 |
| TC-007 | `/admin/projects` direct URL | ✅ PASS | 200 |
| TC-008 | Unknown route falls back to SPA | ✅ PASS | `/nonexistent-route` → 200 + root div |
| TC-009 | Unknown API path does **not** fall back to SPA | ✅ PASS | `/api/nope` → 404 JSON, 79 B |
| TC-010 | JS bundle loads | ✅ PASS | 222 370 B, `application/javascript` |
| TC-011 | CSS bundle loads | ✅ PASS | 25 609 B |
| TC-012 | Tableau logo asset loads | ✅ PASS | 106 253 B `image/png`, cache HIT |
| TC-013 | Favicon loads | ✅ PASS | 309 B `image/svg+xml` |
| TC-014 | Production runs latest commit | ✅ PASS | §7.1 marker strings present |
| TC-015 | `noindex, nofollow` present | ✅ PASS | guest list kept out of search indexes |
| TC-016 | Successful check-in end to end | ⛔ BLOCKED | writes a production row |
| TC-017 | Successful lunch claim end to end | ⛔ BLOCKED | writes a production row |

**TC-014 detail.** Marker strings unique to `30f47ed` were confirmed in the served bundle:
`Submitted Projects`, `Project Uploads`, `MEMBERS PER TEAM`, `MEMBERS TO IGNORE`, `Last updated`, and
the validated donut colours `#d97706` / `#7c3aed`. `Tableau Visionaries` is correctly **absent** —
team names are generated server-side and never shipped to the client.

## 9. Security testing results

| ID | Test | Result | Evidence |
|---|---|---|---|
| TC-020 | Google private key in bundle | ✅ PASS | 0 occurrences |
| TC-021 | `SESSION_SECRET` in bundle | ✅ PASS | 0 occurrences |
| TC-022 | `ADMIN_PASSWORD` in bundle | ✅ PASS | 0 occurrences |
| TC-023 | Service-account address in bundle | ✅ PASS | 0 occurrences |
| TC-024 | `GOOGLE_SHEET_ID` / spreadsheet URL in bundle | ✅ PASS | 0 occurrences |
| TC-025 | Attendee PII in bundle | ✅ PASS | `gmail.com`, `qub.ac.uk`, `Jain Veg Meal` → 0 |
| TC-026 | Snapshot file reachable from browser | ✅ PASS | `registrations.json` string absent; server-side only |
| TC-027 | HSTS | ✅ PASS | `max-age=63072000; includeSubDomains; preload` |
| TC-028 | API responses non-cacheable | ✅ PASS | `no-store, max-age=0` |
| TC-029 | MIME sniffing blocked | ✅ PASS | `X-Content-Type-Options: nosniff` |
| TC-030 | Referrer policy | ✅ PASS | `same-origin` |
| TC-031 | CORS not permissive | ✅ PASS | no `Access-Control-Allow-Origin` for a foreign Origin |
| TC-032 | Stack traces / internals in errors | ✅ PASS | no error body carried Google wording, paths or stack frames |
| TC-033 | Attendee enumeration via check-in | ✅ PASS | 404 returns `{success,status}` only — no name, no attendee object |

## 10. Authentication testing

| ID | Test | Result | Evidence |
|---|---|---|---|
| TC-040 | Valid admin login | ⛔ BLOCKED | requires production credentials (§27) |
| TC-041 | Invalid password | ⛔ BLOCKED | login limiter is 8 per 15 min **per IP** — probing risks locking the organizer out from this network on event day |
| TC-042 | Repeated failed logins → 429 | ⛔ BLOCKED | same reason; deliberately not exercised |
| TC-043 | Session persistence / logout | ⛔ BLOCKED | depends on TC-040 |

**Why TC-041/042 were refused.** These are ordinarily routine. Here the rate limiter keys on client
IP, and the workstation running this audit shares an egress IP with the organizer. Burning the
budget could deny admin access for 15 minutes. The limiter's behaviour is asserted by local tests
(📄 CODE) but is **not** production-verified.

## 11. Authorization testing

| ID | Test | Result | Evidence |
|---|---|---|---|
| TC-050 | `GET /api/admin/stats` anonymous | ✅ PASS | 401 `UNAUTHORIZED` |
| TC-051 | `GET /api/admin/checkins` anonymous | ✅ PASS | 401 |
| TC-052 | `GET /api/admin/projects` anonymous | ✅ PASS | 401 |
| TC-053 | `GET /api/admin/teams?size=5` anonymous | ✅ PASS | 401 |
| TC-054 | `GET /api/admin/session` anonymous | ✅ PASS | 401 |
| TC-055 | Forged cookie `made.up` | ✅ PASS | 401 |
| TC-056 | Empty cookie value | ✅ PASS | 401 |
| TC-057 | Unsigned but well-formed payload + fake signature | ✅ PASS | 401 |
| TC-058 | Signature-stripped ("alg none" shaped) token | ✅ PASS | 401 |
| TC-059 | Any admin body leaked in a 401 | ✅ PASS | no attendee data in any 401 response |

**No authentication or authorization bypass was found.** The signed-cookie design held against every
forgery shape attempted.

## 12. Concurrency testing

| ID | Test | Result |
|---|---|---|
| TC-070 | 2 simultaneous check-ins, same attendee | ⛔ BLOCKED |
| TC-071 | 5 simultaneous check-ins, same attendee | ⛔ BLOCKED |
| TC-072 | Rapid repeated clicks | ⛔ BLOCKED |
| TC-073 | Simultaneous check-ins, different attendees | ⛔ BLOCKED |
| TC-074 | Simultaneous lunch claims | ⛔ BLOCKED |

**Every concurrency test requires writing to the live CheckIn sheet and was therefore not executed.**
The three-layer design is covered by local tests including a simulated cross-instance race
(📄 CODE), but **no production concurrency evidence exists**. This is the largest residual risk in
this audit and the reason the verdict is provisional. A safe protocol is proposed in §26.

## 13. Data integrity testing

| ID | Test | Result |
|---|---|---|
| TC-080 | Snapshot ↔ Registrations parity | 📄 CODE — 58 unique attendees, generator refuses duplicates/invalid emails |
| TC-081 | Duplicate rows never inflate counts | 📄 CODE |
| TC-082 | Lunch claim requires check-in | 📄 CODE + partially ✅ PROD (unregistered lunch → 404) |
| TC-083 | Ignored member excluded from teams | ⛔ BLOCKED |
| TC-084 | Registrations remains read-only | 📄 CODE — no write path targets that tab |
| TC-085 | Full trace Registrations → … → Projects | ⛔ BLOCKED |

## 14. Google Sheets integration testing

| ID | Test | Result |
|---|---|---|
| TC-090 | Sheets API slow / times out | ⛔ BLOCKED — cannot induce safely |
| TC-091 | Sheets API returns 5xx | ⛔ BLOCKED |
| TC-092 | Service-account auth failure | ⛔ BLOCKED |
| TC-093 | Missing tab handled | 📄 CODE — `ProjectUploads` auto-created; guarded and idempotent |
| TC-094 | Missing email column | 📄 CODE — refuses to append rather than scattering data |
| TC-095 | Error text leaks to user | ✅ PASS (partial) — no probed error path leaked Google wording |

**Quota analysis (📄 CODE).** Sheets allows 60 reads/min per service account. With the 5 s shared
admin cache, one refresh cycle costs ~3 reads regardless of how many dashboards are open; at a 12 s
interval that is ~15 reads/min, leaving ~45/min for the desk. Each check-in costs 3–4 requests.
**Not production-verified.**

## 15. Team generation testing

All ⛔ **BLOCKED** — the endpoint requires admin authentication.

Covered by local tests only (📄 CODE): 43 people at 5/team → 9 teams sized 5,5,5,5,5,5,5,4,4; every
attendee exactly once; sizes differ by ≤1; no empty teams; fewer people than team size → 1 team;
ignore list case/whitespace tolerant; unmatched and ambiguous names both block the draw; nothing
written to any sheet; unique team names past the end of the curated list.

## 16. Project upload testing

Admin read side ⛔ **BLOCKED** (requires auth). The public submission form **does not exist yet** by
design, so submission-side tests (valid/invalid URL, empty team name, duplicate, simultaneous
submissions) are ➖ **N/A**.

📄 CODE: only `http(s)` links are passed to the browser — `javascript:` and `data:` URLs are stripped
server-side, and links carry `rel="noopener noreferrer"`.

## 17. Top 5 workflow testing

➖ **NOT APPLICABLE.** No Top-5, review, scoring, shortlist or finalize functionality exists in the
codebase. A repository-wide search for `top5|topFive|shortlist|score|finalize` returned nothing in
`src/` or `api/`. **No results are reported for Phase 10 because the feature is not built.**

## 18. Auto-refresh testing

⛔ **BLOCKED** (admin auth). 📄 CODE: 12 s interval from a single constant, interval cleared on
unmount, in-flight guard prevents overlapping requests, polling stops when the tab is hidden and
resumes with an immediate fetch.

**Design observation (not yet a defect):** the dashboard is read-only, so auto-refresh overwriting an
organizer's unsaved edits — called out as critical in the brief — **cannot occur today**, because
there are no editable fields anywhere in the admin UI. This becomes a live risk the moment any
editing feature is added.

## 19. Responsive testing

⬜ **NOT TESTED.** No browser automation available. Viewport meta is present and correct
(`width=device-width, initial-scale=1.0, viewport-fit=cover`) and inputs are set to 16 px to prevent
iOS zoom (📄 CODE), but no rendering was observed at any viewport.

## 20. Accessibility testing

⬜ **NOT TESTED** in a browser or with a screen reader. 📄 CODE only: form labels bound via `useId`,
`aria-invalid` / `aria-describedby` on errors, `role="status"` + `aria-live="polite"` on results,
`role="alert"` on field errors, decorative SVGs `aria-hidden`, donut has a text `aria-label` and each
segment a `<title>`. Donut colours were validated for colour-vision deficiency (ΔE 34.6 protan,
38.2 normal) and every segment is additionally labelled with its own count, so identity never rests
on colour alone.

## 21. Performance observations

| Metric | Value | Note |
|---|---|---|
| `/api/checkin` (snapshot-only path) | 345–441 ms | 5 samples, no cold-start spike |
| HTML shell | 133 ms | Vercel edge cache HIT |
| Logo | 194 ms, 106 KB | see BUG-004 |
| JS bundle | 222 KB raw | ~65 KB gzipped |

**Load projection (📄 CODE, not tested).** The binding constraint is the Google Sheets quota, not
Vercel. 10 concurrent users: comfortable. 50: approaching the read ceiling if several dashboards are
open. 100 near-simultaneous check-ins: expect 429s and Sheets throttling. **Uncontrolled load
testing against production was explicitly not performed.**

## 22. Error handling testing

| ID | Test | Result | Evidence |
|---|---|---|---|
| TC-100 | Invalid email | ✅ PASS | 400 `INVALID_EMAIL` |
| TC-101 | Empty email | ✅ PASS | 400 |
| TC-102 | Missing field | ✅ PASS | 400 |
| TC-103 | `null` email | ✅ PASS | 400 |
| TC-104 | Array email (type confusion) | ✅ PASS | 400 — `String(['a@b.c'])` coercion correctly refused |
| TC-105 | Unregistered email | ✅ PASS | 404, no attendee object |
| TC-106 | Over-long email (260 chars) | ✅ PASS | 400 |
| TC-107 | Wrong method ×4 | ✅ PASS | 405 with `Allow` header |
| TC-108 | Malformed JSON | ⚠️ **FAIL** | 400 with **empty body** — BUG-002 |
| TC-109 | Oversized body (20 KB) | ⚠️ **FAIL** | accepted and processed — BUG-003 |

## 23. Deployment / Vercel testing

| ID | Test | Result |
|---|---|---|
| TC-110 | SPA rewrite excludes `/api/*` | ✅ PASS |
| TC-111 | API security headers applied | ✅ PASS |
| TC-112 | HTTPS + HSTS | ✅ PASS |
| TC-113 | Snapshot bundled into functions (`includeFiles`) | ✅ PASS (inferred) — check-in returns a correct 404 rather than a 500, proving the snapshot loaded |
| TC-114 | `VITE_EBOOKS_URL` configured | ❌ **FAIL** — BUG-001 |
| TC-115 | `REGISTRATIONS_PATH` absent in production | ✅ PASS (inferred) — snapshot resolves, so no bad override |
| TC-116 | Dev config not active in production | ✅ PASS — no dev-only strings in bundle |

## 24. Edge cases

| Case | Result |
|---|---|
| Unicode email (`日本語@例え.com`) | ✅ PROD — accepted by regex, 404, no crash |
| Emoji email (`👍@emoji.com`) | ✅ PROD — 404, no crash |
| HTML/script-shaped email | ✅ PROD — 404, not reflected — BUG-005 (validation looseness only) |
| SQL-shaped email (`'--@x.com`) | ✅ PROD — 404 (no SQL in the stack) |
| Quote/attribute-breaking payload | ✅ PROD — 400 |
| Unknown API route | ✅ PROD — 404 JSON |
| Refresh / back-forward navigation | ⬜ NOT TESTED (no browser) |
| Network interruption mid-submit | ⬜ NOT TESTED |

---

## 25. Bugs found

> **Note on false positives.** An initial secret-exposure scan reported eight "exposures". That was a
> defect in the audit harness (`grep -c -o` emits per-line counts, breaking the comparison), not in
> the application. The scan was corrected and re-run; all results are clean. Reported here for
> transparency.

### BUG-001 — "Explore E-Books" is dead in production

| Field | Value |
|---|---|
| **Severity / Priority** | **P1 — High** / Fix before event |
| **Environment** | Production, commit `30f47ed` |
| **Preconditions** | None |
| **Steps** | 1. Load `/checkin`. 2. Inspect the served JS bundle for the configured URL. |
| **Expected** | After a successful check-in, an "EXPLORE E-BOOKS" button linking to the Drive folder |
| **Actual** | The URL is absent from the bundle. The disabled branch renders: a dashed, greyed-out "E-books link coming soon" notice |
| **Evidence** | `drive.google.com` → **0** occurrences in `/assets/index-CQSpAwNe.js`. Both UI strings (`E-books link coming soon`, `EXPLORE E-BOOKS`) are present, confirming the code shipped and the empty-URL branch is what executes. No `https://` URL other than React/W3C namespaces exists in the bundle. |
| **Root cause** | Vite inlines `VITE_*` at **build** time from the build environment. The value was added to `.env.example`, which Vite never reads, and `.env` is gitignored so Vercel's build had no value. `src/config.js` correctly treats an empty/placeholder value as "not configured" and renders the disabled state — the guard worked exactly as designed; the configuration was simply never supplied. |
| **Fix** | Vercel → Settings → Environment Variables → add `VITE_EBOOKS_URL` = the Drive folder URL, tick **Production**, then **redeploy** (editing a variable alone does not rebuild). |
| **Production impact** | Every attendee who checks in reaches a dead end where the event's only post-check-in call to action should be. Check-in itself is unaffected. |

### BUG-002 — Malformed JSON returns an empty 400 body

| Field | Value |
|---|---|
| **Severity / Priority** | **P3 — Low** / Optional |
| **Steps** | `POST /api/checkin` with body `{ broken` |
| **Expected** | `400 {"success":false,"status":"INVALID_REQUEST"}` |
| **Actual** | `400` with `Content-Length: 0` and no body |
| **Evidence** | Response carried `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` from the `vercel.json` header rule, but no JSON — the application handler never ran; Vercel's body parser rejected the request upstream. |
| **Root cause** | Vercel parses JSON bodies before invoking the function and short-circuits unparseable ones. |
| **Impact** | Negligible for real users — the app only ever sends valid JSON. A hand-crafted bad request surfaces in the UI as "TEMPORARILY UNAVAILABLE" instead of a validation message, because `api.js` maps a null payload to `SERVICE_UNAVAILABLE`. Contract inconsistency, not a functional defect. |
| **Fix** | None required. If exactness matters, document the platform behaviour. |

### BUG-003 — The 8 KB request-body cap does not operate in production

| Field | Value |
|---|---|
| **Severity / Priority** | **P3 — Low** / Recommended |
| **Steps** | `POST /api/checkin` with a ~20 KB JSON body containing a valid `email` field |
| **Expected** | `400 INVALID_REQUEST` (body over `MAX_BODY_BYTES`) |
| **Actual** | `404 REGISTRATION_NOT_FOUND` — the body was accepted, parsed and the email evaluated |
| **Root cause** | On Vercel, `req.body` arrives pre-parsed, so `readJsonBody()` takes its early-return path and never streams or measures the payload. The size cap only applies when the body is a raw stream — i.e. local development. |
| **Impact** | Low. Vercel's own ~4.5 MB function payload limit is the real ceiling, and rate limiting still applies. But the documented protection is not the one in force, and **the local test suite asserts behaviour production does not have** — a false sense of coverage. |
| **Fix** | Check `content-length` before parsing, or accept and document that Vercel's limit governs. |

### BUG-004 — Logo revalidates on every page load

| Field | Value |
|---|---|
| **Severity / Priority** | **P4 — Cosmetic/Perf** / Optional |
| **Actual** | `/logo.png` (106 KB) served with `Cache-Control: public, max-age=0, must-revalidate` |
| **Root cause** | Vercel's default for non-fingerprinted `public/` assets. Hashed JS/CSS get immutable caching; `public/` files do not. |
| **Impact** | An extra conditional request per page view. ETag means a 304, not a re-download, so cost is one round trip — noticeable only on poor event Wi-Fi. |
| **Fix** | Import the logo through Vite so it is content-hashed, or add a `headers` rule in `vercel.json`. |

### BUG-005 — Email validation accepts script- and control-shaped strings

| Field | Value |
|---|---|
| **Severity / Priority** | **P3 — Low** / Optional |
| **Actual** | `<script>alert(1)</script>@x.com`, `'--@x.com`, `👍@emoji.com`, `日本語@例え.com` all pass validation and reach the snapshot lookup (returning 404) |
| **Root cause** | `EMAIL_PATTERN` excludes only whitespace, `@`, `,` and `;`. Angle brackets, quotes and emoji are permitted. |
| **Impact** | **No injection path.** Nothing user-supplied is ever written to Sheets — only `registration.email` from the frozen snapshot is written, and only for addresses that match a registration. Output is React-escaped and the 404 response reflects nothing. This is validation looseness, not a vulnerability. Unicode acceptance is arguably correct behaviour. |
| **Fix** | Optional: tighten the pattern to reject `<>"'` in the local part. |

---

## 26. Risk assessment

| Risk | Likelihood | Impact | Status |
|---|---|---|---|
| Attendees hit a dead e-books button | **Certain** | Medium | BUG-001 — fix before event |
| Duplicate check-in rows under concurrent load | Unknown | **High** | **Unverified in production** |
| Sheets read quota exhausted by dashboards | Low–Medium | High | Mitigated in code; unverified |
| Admin credential/session compromise | Low | High | Strong — no bypass found |
| Secret leakage to browser | None observed | Critical | Verified clean |
| Attendee data exposure | None observed | High | Verified clean |
| Mobile rendering defect | Unknown | Medium | **Never observed** |

### Proposed controlled test to close the concurrency gap

This is the one gap I would not run an event without closing. Requires your approval.

1. You nominate **one** attendee — ideally your own registered address — as the test subject.
2. I fire **5 simultaneous** `POST /api/checkin` requests for that address.
3. Expected: exactly one `200 CHECKED_IN`, four `409 ALREADY_CHECKED_IN`.
4. You inspect the CheckIn sheet: expected exactly **one** row with status `Checked In`; if a
   cross-instance race occurred, at most one additional row marked `Duplicate (ignored)`.
5. **Data written:** 1–2 rows in `CheckIn` for one known address. **Reversible** — delete the rows
   before the event, while nothing else is writing.

Total production writes: 1–2 rows. Nothing deleted, nothing overwritten, no other attendee touched.

## 27. Recommendations

**Before the event**

1. Set `VITE_EBOOKS_URL` in Vercel and redeploy — BUG-001.
2. Run the controlled concurrency test in §26.
3. Sign in to `/admin` once yourself and confirm: the dashboard loads, the donut renders,
   `ProjectUploads` is created, and team generation works. This also settles most of §15 and §18.
4. Open `/checkin` on an actual phone. Nothing in this audit observed the UI at any viewport.
5. Confirm the snapshot is regenerated after registrations close on 15 August — the deployed snapshot
   is dated 2026-08-08 and is provisional.

**Optional**

6. Content-hash the logo — BUG-004.
7. Add a `content-length` guard — BUG-003.
8. Tighten the email pattern — BUG-005.

## 28. Production readiness assessment

### 🟡 READY WITH MINOR FIXES — **provisional**

**Why not green.** One P1 configuration defect is confirmed and unfixed, and the highest-risk
subsystem for a live event — concurrent writes to Google Sheets — has **no production evidence**
behind it. The design is sound and locally well tested, but the brief is explicit that code
correctness is not production verification, and I will not certify what I did not observe.

**Why not orange or red.** Nothing found is broken in a way that would stop the event. The security
posture is genuinely strong and was verified directly against production: no auth bypass, no secret
exposure, no data leakage, no injection path. Input validation, routing, headers and latency all pass
on production. The single P1 is a two-minute environment-variable change, not a code defect.

**This verdict upgrades to 🟢 once** BUG-001 is fixed and redeployed, the §26 concurrency test passes,
and one admin session plus one real mobile page load have been confirmed.

---

## Production safety summary

### Production tests actually executed

Read-only or rejected-path only. 9 route probes; 4 asset fetches; 2 header inspections; 1 bundle
download and scan; 5 admin authorization probes; 4 forged-cookie probes; 9 attendee validation
probes (all rejected paths); 4 method probes; 6 edge-case email probes; 1 oversized-body probe;
1 over-long-email probe; 1 CORS probe; 5 latency samples.

**Approximately 50 requests total**, spaced, well inside rate limits. No load or stress testing.

### Google Sheets data modified during QA

**No production Google Sheets data was modified during QA.**

No row was created, updated or deleted in `Registrations`, `CheckIn`, `Lunch` or `ProjectUploads`. No
sheet or tab was created. Every attendee-endpoint probe used addresses guaranteed absent from the
frozen snapshot (`qa-not-registered-9f2a@example.com`, `qa-latency-probe@example.com` and malformed
variants), all of which are rejected **before** any Google API call is made.

### Tests blocked for production safety

| Blocked | Reason |
|---|---|
| Successful check-in / lunch claim | Appends real rows |
| All concurrency and race testing | Appends real rows |
| All authenticated admin testing | Requires production credentials |
| `GET /api/admin/projects` | Creates the `ProjectUploads` tab — a structural write |
| Invalid-login and login rate-limit probes | Limiter is per-IP; this workstation shares an egress IP with the organizer, so probing risks a 15-minute admin lockout |
| Load / stress testing | Would consume Sheets quota and Vercel invocations |
| Google Sheets failure injection | Cannot be induced without damaging live configuration |

### Tests not executed for lack of tooling

Responsive rendering, visual QA, console-error capture, keyboard/screen-reader accessibility,
browser compatibility, back/forward navigation, network-interruption behaviour. **No headless
browser was available.** These are reported as NOT TESTED, not inferred.

### Production confidence

**MEDIUM.**

**High confidence in:** security posture, authorization boundary, secret containment, input
validation, routing, deployment configuration, latency. These were exercised directly against
production and passed comprehensively.

**Low confidence in:** anything requiring a successful write or an admin session — concurrency,
duplicate protection under load, dashboard correctness, team generation, project uploads,
auto-refresh. These represent a large share of the application's event-day surface and rest entirely
on local test evidence.

**No confidence claimed in:** rendering, responsiveness, accessibility or browser behaviour. Not
observed at all.

Confidence rises to HIGH once §26 and recommendations 1–4 are complete.
