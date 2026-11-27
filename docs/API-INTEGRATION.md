# API Integration Documentation

Sweet Creatures Attendance and Payroll System, REST API (Node.js / Express, MySQL).
Prepared: November 26, 2026.

## 1. How the pieces connect

```
Browser (admin app / staff PWA)
   |  HTTPS
   v
Amazon CloudFront  --  /*      -->  S3 bucket (static frontend)
                   --  /api/*  -->  Application Load Balancer --> ECS Fargate (Express API, port 3000) --> RDS MySQL
```

- Base URL (live): `https://d3qyrpbrdugqq1.cloudfront.net/api`
- The frontend calls the API with relative paths (`/api/...`), so there is no cross-origin request in production. In local development the admin app calls `http://localhost:5000/api`.
- CloudFront does not cache `/api/*` responses.
- Health check (used by the load balancer): `GET /health` returns `200 OK` with no authentication.

## 2. Authentication

1. `POST /api/auth/login` with a username and PIN returns a JWT (valid for 12 hours by default).
2. Send it on every other request: `Authorization: Bearer <token>`.
3. The server re-checks the account on every request. An account that is not `Active` (Inactive or Locked) gets `401`.
4. Roles are `Admin` and `Staff`. Admin-only endpoints return `403` for a Staff token.
5. PINs are 4 to 6 digits and are stored only as bcrypt hashes. After 5 failed attempts the account is locked (`423`) until an admin unlocks it.

## 3. Conventions

- Requests and responses are JSON. Photos are sent as base64 data URLs inside JSON (limit about 1.5 million characters per photo; request body limit 3 MB).
- Dates are `YYYY-MM-DD`. Times are stored in Manila time (Asia/Manila).
- Error bodies contain a `message` field. Some payroll and attendance endpoints also include `success: false`.
- Common status codes: `400` invalid input, `401` missing/invalid token or inactive account, `403` wrong role, `404` not found, `409` conflict or business-rule violation, `413` photo too large, `423` account locked, `500` server error.

## 4. Endpoints

### 4.1 Auth (`/api/auth`)

| Method and path | Access | Body / query | Response |
|---|---|---|---|
| `POST /login` | Public | `{ username, pin }` | `{ token, user: { id, role, firstName, lastName, username } }`. Errors: `401` wrong username or PIN (with attempts left), `423` locked, `403` deactivated |
| `GET /me` | Any logged-in user | none | The current user record (no PIN hash) |
| `POST /register` | Admin | `{ firstName, middleName?, lastName, username, email, pin, role?, jobPosition?, hourlyRate? }` | `201 { message, userId }` |
| `PATCH /users/:id/unlock` | Admin | none | `{ message: "Account unlocked." }` |

### 4.2 Employees (`/api/employees`, Admin only)

| Method and path | Body | Notes |
|---|---|---|
| `GET /` | none | Returns `{ rows: [...] }` with `user_id, first_name, middle_name, last_name, username, account_role, job_position, hourly_rate, created_at, email, account_status` |
| `POST /` | `{ firstName, middleName?, lastName, username, email, pin, role?, jobPosition?, hourlyRate? }` | `201`. Duplicate username or email returns `409` |
| `GET /:id` | none | One employee |
| `PATCH /:id` | any of `firstName, middleName, lastName, email, jobPosition, hourlyRate, role` | Admin cannot remove their own Admin role |
| `PATCH /:id/deactivate` | none | Sets status `Inactive`. History is kept. Cannot deactivate yourself |
| `PATCH /:id/reactivate` | none | Sets status `Active` |
| `PATCH /:id/pin` | `{ pin }` (4 to 6 digits) | Admin PIN reset |
| `GET /:id/promotions` | none | Change history of one employee: effective date, position, rate, role, reason and who made the change. The first entry holds the starting values |
| `POST /:id/promotions` | `{ effectiveDate, jobPosition?, hourlyRate?, role?, reason? }` | Records a promotion or pay change. `effectiveDate` is `YYYY-MM-DD` and cannot be in the future. At least one of position, rate or role is required. Refused with `409` if pay or position would change on or before the last finalized payroll cutoff. An admin cannot remove their own Admin role |

### 4.3 Attendance (`/api/attendance`)

| Method and path | Access | Body / query | Notes |
|---|---|---|---|
| `POST /` | Staff | `{ clientId, action, photo?, source?, timestamp? }` | `action` is `time_in`, `break_start`, `break_end` or `time_out`. A photo (data URL) is required for `time_in` and `time_out`. `clientId` makes retries safe: the same `clientId` returns the saved result instead of creating a duplicate. `source: "offline"` entries keep their original time (up to 7 days old) and are flagged for review ("Logged while offline") |
| `GET /mine` | Staff | none | Array of the user's own events for the last 60 days (`clientId, staffId, date, action, timestamp, status, flag, flagReason, flagRemarks, syncedAt`) |
| `GET /day?date=YYYY-MM-DD` | Admin | optional `date` (default today) | `{ date, isToday, summary: { total, present, onTime, late, flagged, absent }, rows: [...] }` |
| `GET /flagged?status=Pending` | Admin | optional `status` (`Pending`, `Approved`, `Rejected`) | Flagged records (offline entries and missed time-outs) |
| `GET /` | Admin | `date_from, date_to, user_id` | Attendance history, up to 500 rows |
| `GET /:id/photos` | Admin | none | `[{ id, type, capturedAt, data }]` |
| `PATCH /:id/review` | Admin | `{ decision: "Approved" or "Rejected", notes?, timeOut? }` | Only `Pending` items can be reviewed. `timeOut` (`HH:MM`) lets the owner supply a real time-out when approving a missed one |

Business rules: one time-in per day (`409` if repeated), breaks and time-out must follow the correct order, lateness is computed from the policy (shift start plus grace period).

### 4.4 Payroll (`/api/payroll`)

| Method and path | Access | Notes |
|---|---|---|
| `POST /cutoffs` | Admin | `{ start_date, end_date }` creates a cutoff |
| `POST /cutoffs/ensure` | Admin | Same body, creates the cutoff only if it does not exist |
| `GET /cutoffs` | Admin | List of cutoffs |
| `POST /cutoffs/:cutoffId/generate` | Admin | Computes draft payslips for every staff member |
| `GET /cutoffs/:cutoffId/payslips` | Admin | Payslip rows (basic pay, overtime, late/undertime deduction, cash advance deduction, net pay) |
| `PATCH /payslips/:payslipId` | Admin | Edit a draft payslip |
| `POST /cutoffs/:cutoffId/finalize` | Admin | Locks the payslips. Approved cash advances of that cutoff become `Deducted` |
| `GET /payslips/me` | Staff | The user's own finalized payslips |
| `GET /payslips/:payslipId` | Admin or owner | Admin can read any. Staff can read their own finalized payslip |

Net pay = basic pay + overtime pay - late/undertime deduction - cash advance deduction.

Pay rate by date: each attendance day is paid at the hourly rate in force on that day, using the change history recorded through `POST /api/employees/:id/promotions`. An employee with no recorded change is paid at the current rate for every day. The rate shown on the payslip is the rate in force on the last day of the cutoff. After a back-dated change, regenerate the draft payslips of open cutoffs. Finalized payslips never change.

Review status and pay: shifts that are Pending or Rejected are not paid, except that a shift whose only rejected item was overtime is still paid for its regular hours.

### 4.5 Cash advances (`/api/cash-advances`)

| Method and path | Access | Body / query | Notes |
|---|---|---|---|
| `GET /mine` | Staff | none | The user's own advances |
| `GET /` | Admin | optional `status` | All advances |
| `GET /limit?userId=&start=&end=` | Admin | | `{ max, reserved, available }` for that staff member and cutoff |
| `POST /` | Admin | `{ userId, amount, dateGranted, cutoffStart, cutoffEnd, notes? }` | Created as `Pending`. Limit: the lower of PHP 1,640 or 50% of projected cutoff pay, otherwise `409` |
| `PATCH /:id` | Admin | `{ status: "Pending"/"Approved"/"Rejected", notes? }` | Cannot change an advance that is already `Deducted` |

### 4.6 Attendance policy (`/api/policy`)

| Method and path | Access | Notes |
|---|---|---|
| `GET /` | Any logged-in user | Current policy (staff app reads it for shift rules) |
| `GET /history` | Admin | Previous policy versions |
| `PUT /` | Admin | `{ shiftStart, graceMinutes, lateRule, undertimeRule, standardShift, overtimeAfterHours, otMultiplier }`. Saving creates a new version |

### 4.7 SOPs (`/api/sops`)

| Method and path | Access | Body / query | Notes |
|---|---|---|---|
| `GET /` | Any logged-in user | Admin may add `?all=1` | Returns an array of `{ id, title, body, version, status, updatedAt }`. Staff only receive `published` SOPs. Admin with `?all=1` also receives drafts |
| `POST /` | Admin | `{ title, body, status }` | `status` is `published` or `draft`. Starts at version `v1` |
| `PUT /:id` | Admin | `{ title, body, status }` | Each save increases the version |

### 4.8 Time-in schedule (`/api/schedules`)

| Method and path | Access | Body | Notes |
|---|---|---|---|
| `GET /today` | Any logged-in user | none | The schedule in force today, or `null`: `{ id, timeInOpens, regularTimeOut, otGraceMinutes }`. The staff app uses it to show when time-in opens |
| `GET /` | Admin | none | All schedules with a `status` of `Current`, `Upcoming`, `Superseded` or `Expired` |
| `POST /` | Admin | `{ effectiveFrom, effectiveTo?, timeInOpens, regularTimeOut?, otGraceMinutes? }` | Dates are `YYYY-MM-DD`, times are `HH:MM`. Leaving `effectiveTo` empty keeps the schedule until a newer one starts. Grace defaults to 15 minutes |
| `DELETE /:id` | Admin | none | Removes a schedule. Existing attendance records are not changed |

Rules applied by `POST /api/attendance`:
- If a schedule is in force and an online time-in arrives before `timeInOpens`, the request is refused with `409` and the message "Time in opens at 7:30 AM." No record is created.
- An offline time-in before the opening time is saved but flagged "Timed in before opening time" for the administrator to review.
- If `regularTimeOut` is set and a time-out is later than `regularTimeOut` plus the grace period, the hours after `regularTimeOut` are held as overtime. The record is flagged "Overtime pending approval (n h)" and its paid hours stop at the regular time-out.
- `PATCH /api/attendance/:id/review` with `Approved` adds the held overtime hours to the paid totals. `Rejected` leaves only the regular hours.
- With no schedule, there is no restriction and behavior is unchanged.

### 4.9 Utility

| Method and path | Access | Notes |
|---|---|---|
| `GET /health` | Public | `200 OK`, used by the load balancer health check |
| `GET /api/test-db` | Public | Runs `SELECT 1 + 1` to confirm the database connection |

## 5. Frontend integration

- **Admin app** (`frontend/app.js`): one helper, `apiRequest(path, { method, body })`, adds the Bearer token from `sessionStorage` and turns error responses into readable messages. After login it loads employees, today's attendance, flagged items, cash advances, policy, payroll cutoffs and SOPs in parallel.
- **Staff app** (`frontend/staff-app.js`, `staff-api.js`): runs in backend mode (`window.SC_CONFIG = { mode: 'backend' }`). The login token is kept in `localStorage` for 12 hours. Attendance actions are queued in IndexedDB when offline and sent later with the same `clientId`, so a retry never creates duplicates. A service worker caches the app shell so the staff app opens without a connection.
- **One login for everyone**: the admin login page calls `/api/auth/login`, and a Staff role is redirected to `staff-index.html`.

## 6. Example calls

```
# Log in
curl -X POST https://d3qyrpbrdugqq1.cloudfront.net/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<username>","pin":"<pin>"}'

# List employees (Admin)
curl https://d3qyrpbrdugqq1.cloudfront.net/api/employees \
  -H "Authorization: Bearer <token>"

# Create a published SOP (Admin)
curl -X POST https://d3qyrpbrdugqq1.cloudfront.net/api/sops \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"title":"Opening Procedure","body":"1. Unlock the shop...","status":"published"}'

# Reset a staff PIN (Admin)
curl -X PATCH https://d3qyrpbrdugqq1.cloudfront.net/api/employees/5/pin \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"pin":"482916"}'
```
