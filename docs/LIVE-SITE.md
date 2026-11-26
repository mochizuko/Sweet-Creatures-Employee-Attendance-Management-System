# Live Site

| What | Link |
|---|---|
| Admin / owner web app | https://d3qyrpbrdugqq1.cloudfront.net |
| Staff app (PWA) | https://d3qyrpbrdugqq1.cloudfront.net/staff-index.html |
| Source code | https://github.com/mochizuko/Sweet-Creatures-Employee-Attendance-Management-System (branch `Aws-deployent`) |

Both apps are served over HTTPS by Amazon CloudFront. Requests to `/api/*` are forwarded to the backend API running on AWS.

## How to try it
1. Open the admin link and log in with the admin account (username and PIN are given to the evaluator separately; credentials are not stored in this repository).
2. Admin pages to look at: Dashboard, Staff, Attendance, Flagged, Payroll, Cash Advances, Policy, SOP.
3. Open the staff link on a phone or in another browser and log in with a demo staff account (Kaye, Lysa, Trishia or Grace; the PIN is given separately).
4. Staff pages: Home (time in/out with photo), Attendance log, Payslips, Cash advances, SOP, Sync status.

## Availability note
The project runs on AWS free-plan credits. After grading, the AWS resources will be shut down to stop billing, so the link will stop working after that.
