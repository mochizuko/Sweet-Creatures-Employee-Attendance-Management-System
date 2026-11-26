# Test Cases and Logs

Sweet Creatures Attendance and Payroll System, deployed on AWS (ap-southeast-2).
Prepared: November 26, 2026. Environment: live site https://d3qyrpbrdugqq1.cloudfront.net

## How to read this document
- **Summary:** 36 test cases. 35 PASS, 1 NOT RUN, (last updated 2026-11-26).
- **Section 1** lists the test cases. The **Result** column uses:
  - `PASS (observed)`: seen working on the live site during deployment, as noted in the log.
  - `NOT RUN`: skipped, with the reason given.
  - `TO RUN`: the test is defined but its result has not been recorded yet. Run it on the live site, then replace `TO RUN` with `PASS` or `FAIL`, add the date, and attach a screenshot name in the Evidence column.
- **Section 2** is the deployment and pipeline log (real command output and timestamps).
- **Section 3** is the incident log (problems found and how each was fixed).

## 1. Test cases

### Authentication and accounts
| ID | Test | Steps | Expected result | Result | Evidence |
|---|---|---|---|---|---|
| TC-01 | Admin login | Open the site, enter admin username and PIN | Dashboard opens | PASS (observed) | Admin dashboard loaded on the live site |
| TC-02 | Wrong PIN | Log in with a wrong PIN | Message "Invalid username or PIN" with attempts left | PASS | Live site, 2026-11-26 |
| TC-03 | Account lockout | Enter a wrong PIN 5 times for a demo account | Account locked, login returns "Account is locked" | TO RUN | |
| TC-04 | Admin unlock | Staff page, Unlock on the locked account | Status becomes Active, user can log in | TO RUN | |
| TC-05 | Staff login | Log in as a demo staff on the admin login page | Redirected to the staff app | PASS (observed) | Staff app used for photo upload test |
| TC-06 | Deactivated account | Deactivate a demo staff, then try to log in as them | Login refused with "Account is deactivated" | PASS | Live site, 2026-11-26. Deactivated account refused at login |

### Staff management
| ID | Test | Steps | Expected result | Result | Evidence |
|---|---|---|---|---|---|
| TC-07 | Staff list from database | Open Staff page | Demo staff (Kaye, Lysa, Trishia, Grace) listed with status | PASS (observed) | Staff list loaded |
| TC-08 | Add staff | Add Staff, fill the form, save | New account appears in the list | PASS | |
| TC-09 | Admin PIN reset | Staff page, Reset PIN, enter 4 to 6 digits | Success message. New PIN works at login, old one does not | PASS | Live site, 2026-11-26. PIN reset by admin, login with new PIN |
| TC-10 | Deactivate and reactivate | Deactivate (confirm), then Reactivate | Status changes Inactive then Active. History is kept | PASS | Live site, 2026-11-26. Deactivate then reactivate |
| TC-11 | PIN validation | Reset PIN with 3 digits or letters | Rejected with "PIN must be 4 to 6 digits" | PASS | Live site, 2026-11-26. Short PIN rejected |

### Attendance
| ID | Test | Steps | Expected result | Result | Evidence |
|---|---|---|---|---|---|
| TC-12 | Dashboard summary | Open the admin dashboard | Present Today shows "n / 4" for the 4 demo staff | PASS (observed) | Showed 0 / 4 before any time-in |
| TC-13 | Time in with photo | Staff app, Time In, take photo | Record saved, photo visible in admin app | PASS (observed) | Photo upload worked and showed in admin app |
| TC-14 | Duplicate time in | Time In twice on the same day | Second attempt refused ("You already timed in today") | PASS | Live site, 2026-11-26 |
| TC-15 | Break and time out order | Try Time Out during a break | Refused ("Finish your break before timing out") | PASS | Live site, 2026-11-26 |
| TC-16 | Offline entry | Turn off the network, Time In, turn it on, Sync | Entry sent once, appears flagged "Logged while offline" | PASS | Live site, 2026-11-26 |
| TC-17 | Flag review | Flagged page, Approve or Reject an item | Status changes. Approved items count toward payroll | PASS | Live site, 2026-11-26 |
| TC-18 | Missed time out | Leave a shift open past midnight | Next-day record flagged "Missed Time Out" | NOT RUN | Needs a shift left open past midnight; not run in the available time |

### Payroll and cash advances
| ID | Test | Steps | Expected result | Result | Evidence |
|---|---|---|---|---|---|
| TC-19 | Compute payroll | Payroll page, choose cutoff, Compute | One draft payslip per staff with correct totals | PASS | Live site, 2026-11-26 |
| TC-20 | Finalize payroll | Finalize Payslips | Payslips locked. Approved advances marked Deducted | PASS | Live site, 2026-11-26 |
| TC-21 | Staff payslip view | Staff app, Payslips tab after finalizing | Values match the admin payslip (not zero) | PASS | Live site, 2026-11-26 |
| TC-22 | Create cash advance | Cash Advances, add an amount within the limit | Saved as Pending | PASS | Live site, 2026-11-26 |
| TC-23 | Advance over limit | Add an amount above the limit | Refused with the maximum allowed shown | PASS | Live site, 2026-11-26 |
| TC-24 | Approve advance | Approve a Pending advance | Status Approved, staff sees it in the staff app | PASS | Live site, 2026-11-26 |

### Policy and SOP
| ID | Test | Steps | Expected result | Result | Evidence |
|---|---|---|---|---|---|
| TC-25 | Save policy | Policy page, change grace period, save | New policy version in history | PASS (observed) | |
| TC-26 | Create SOP | SOP page, + New SOP, status Published, save | Appears in the SOP table as v1, visible in the staff app | PASS | Live site, 2026-11-26 |
| TC-27 | Draft SOP hidden | Create an SOP with status Draft | Visible to admin only, not in the staff app | PASS | Live site, 2026-11-26 |
| TC-28 | Edit SOP | Edit an SOP and save | Version number increases | PASS | Live site, 2026-11-26 |

### Security and infrastructure
| ID | Test | Steps | Expected result | Result | Evidence |
|---|---|---|---|---|---|
| TC-29 | HTTPS site | Open the live link | Loads over HTTPS (CloudFront) | PASS (observed) | Live site opened |
| TC-30 | Health check | Open `/health` on the API | `OK`, status 200 | PASS | PowerShell 2026-11-26: /api/test-db returned success True; ALB /health returned OK |
| TC-31 | No token | `GET /api/employees` without a token | `401` | PASS | PowerShell 2026-11-26: GET /api/employees without token returned 401 |
| TC-32 | Wrong role | Call an admin endpoint with a staff token | `403` | PASS | PowerShell 2026-11-26: staff token (grace) on /api/employees returned 403 |
| TC-33 | Data persists | Redeploy the API, reload the site | Data still present (it lives in RDS, not the container) | PASS (observed) | Data showed after force-redeploys |

### CI/CD
| ID | Test | Steps | Expected result | Result | Evidence |
|---|---|---|---|---|---|
| TC-34 | Pipeline starts on push | Push a commit to `Aws-deployent` | A new workflow run appears in GitHub Actions | PASS (observed) | Runs #1 and #2 |
| TC-35 | Checks pass | Open the run | "Detect changes" and "Check code" green | PASS (observed) | Both green in runs #1 and #2 |
| TC-36 | Automatic deploy | Re-run after fixing AWS sign-in | Backend and frontend deploy jobs green | PASS (observed) | All four jobs green |

## 2. Deployment and pipeline log

Times are UTC unless noted (Manila is UTC+8).

### 2.1 Update 3 (banner text), packaging
```
git commit -m "Update 3: banner text"      -> commit 786ffed (11 files changed, 664 insertions, 725 deletions)
git archive --format=zip -o sc-source.zip HEAD   -> sc-source.zip, 377,295 bytes (tracked files only; node_modules and .env excluded)
```

### 2.2 Build and push (AWS CloudShell)
```
docker build -t sweet-creatures-api:latest .     -> succeeded, "naming to docker.io/library/sweet-creatures-api:latest"
docker login (ECR)                                -> Login Succeeded
docker push 940836045674.dkr.ecr.ap-southeast-2.amazonaws.com/sweet-creatures-api:latest
                                                  -> layers pushed, "latest: digest: sha256:..."
```

### 2.3 Database migration (ECS Fargate task, command: node src/scripts/migrate.js)
```
aws logs tail /ecs/sweet-creatures-api --since 15m
  ~16 lines "added <table>.<column>" (new columns)
  Migration complete.
```

### 2.4 Demo data seed (ECS Fargate task, command: node src/scripts/seedDemo.js)
```
  Seed complete.   (2026-11-25T17:53:34Z = 2026-11-26 01:53 Manila)
  Demo staff: Kaye, Lysa, Trishia, Grace
```

### 2.5 Release of code and frontend
```
aws ecs update-service --cluster sweet-creatures-cluster --service sweet-creatures-api-service-zkj8co1t --force-new-deployment
aws s3 sync ~/build/frontend s3://sweet-creatures-web-940836045674/ --exclude "*.md"
aws cloudfront create-invalidation --distribution-id E3T9UNN9V7TOF7 --paths "/*"
  Invalidation I7BAORRXHK1BCLV14TV5E61GJU  created 2026-11-25T19:53:56Z  Status: InProgress
  Invalidation I1E09AEQRBLWAM4OU4NMIHC1L4  created 2026-11-25T20:04:13Z  Status: InProgress
```

### 2.6 Git history of the final changes
```
786ffed  Update 3: banner text
3091d71  Add CI/CD pipeline
9c6dfdb  Stop tracking deployment helper files and zip
```

### 2.7 API verification from PowerShell (2026-11-26)
```
Invoke-RestMethod https://d3qyrpbrdugqq1.cloudfront.net/api/test-db
  success True | message "Connected to sweet_creatures database successfully!" | solution 2
Invoke-RestMethod http://sc-alb-1762454460.ap-southeast-2.elb.amazonaws.com/health
  OK
GET /api/employees (no token)                        -> 401
POST /api/auth/login (demo staff "grace")            -> token issued
GET /api/employees (staff token)                     -> 403
POST /api/auth/login (username that does not exist)  -> {"message":"Invalid username or PIN."}
```

### 2.8 GitHub Actions
| Run | Commit | Result | Note |
|---|---|---|---|
| #1 "Add CI/CD pipeline" | 3091d71 | Check code green, deploy jobs failed | AWS sign-in refused (see incident 3) |
| #2 "Stop tracking deployment helper files and zip" | 9c6dfdb | Check code green, deploy jobs failed | Same cause |
| Re-run after trust policy fix | 9c6dfdb | All four jobs green | Detect changes, Check code, Deploy backend, Deploy frontend |

## 2a. Observations from testing
- The load balancer `/health` answered a direct request from the internet, so the ALB is reachable without going through CloudFront. Locking it to CloudFront is a planned hardening step.
- `GET /api/test-db` is public and reveals the database name. It should be removed or protected for production use.
- Login messages differ: a wrong PIN for an existing account adds "N attempt(s) left", while an unknown username returns only "Invalid username or PIN." This lets someone tell which usernames exist. A single identical message would remove the difference.

## 3. Incident log

| # | What happened | Cause | Fix |
|---|---|---|---|
| 1 | First seed task failed: `ParamValidation: Invalid JSON ... "value":""` | The PIN variable was empty because a long command was pasted before the PIN prompt finished | Re-entered the PIN, confirmed "PIN length: 6", re-ran the task. Log then showed "Seed complete." |
| 2 | `aws login` could not finish in Windows PowerShell (token expired after the browser step) | Local credential flow problem | Ran Docker build, push and ECS tasks from AWS CloudShell instead |
| 3 | GitHub Actions deploy jobs failed with `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity` | AWS CloudTrail showed event `AssumeRoleWithWebIdentity`, `errorCode: AccessDenied` (2026-11-25T20:46:15Z and 20:46:40Z). GitHub's token subject was `repo:mochizuko@182063318/Sweet-Creatures-Employee-Attendance-Management-System@1449057664:ref:refs/heads/Aws-deployent`. It contains numeric IDs, so the trust policy pattern without them never matched | Updated the IAM role trust policy to accept both subject formats (`aws iam update-assume-role-policy`). Re-ran the workflow: all jobs green |
| 4 | A zero-value payslip showed in the staff app | The staff app read camelCase fields but the API returns snake_case (`basic_pay`, `net_pay`, ...) | Added a field mapping in `staff-api.js` (Update 4) |
| 5 | Admin SOP buttons did nothing | The SOP page was static sample HTML with no handlers | Built the SOP page against `/api/sops` (Update 4) |
| 6 | Admin had no PIN reset or activate/deactivate buttons | Backend routes existed, no UI | Added Actions column and PIN dialog (Update 5) |
| 7 | A deactivated user with a correct PIN received a token, then every request failed | Login only blocked `Locked` accounts | Login now returns "Account is deactivated" for `Inactive` accounts (Update 5) |
| 8 | Laptop and phone showed different attendance, advances and payslips | Not fully confirmed. Likely different staff accounts per device, or an old cached copy of the staff app. The staff app also hides failed requests | Cache version bumped to `v9` (Update 4). Compare the logged-in account on each device, and clear site data on the device that looks wrong |
