# Defense Script: AWS Deployment and CI/CD

Sweet Creatures Attendance and Payroll System. Group 7. About 8 minutes when read at a normal pace.
Replace "we" with the speaker's name where you split the parts. Items in [brackets] are demo actions.

---

## 1. Opening (30 seconds)
Good day. Our system is the Sweet Creatures Attendance and Payroll System. Staff record their time in and out with a live photo on a phone, and the owner reviews attendance, runs payroll and manages cash advances from a web dashboard.

Today we will show how we deployed it on Amazon Web Services, why we picked each service, and how our CI/CD pipeline releases changes automatically.

## 2. The architecture in one request (2 minutes)
[Show the architecture diagram or `docs/AWS-SETUP-AND-RATIONALE.md`.]

Let me follow one request. When a staff member opens our link, the request goes to **Amazon CloudFront**. CloudFront gives us HTTPS and serves the web pages from a **private S3 bucket**. The bucket is not public. Only CloudFront can read it.

When the app needs data, like logging attendance, the call goes to the same address under `/api`. CloudFront forwards it to an **Application Load Balancer**, which sends it to one of two copies of our API. The API runs in **ECS Fargate**, which means we run our Docker container without managing any servers. The API talks to a **MySQL database on Amazon RDS**.

The API and the database are in **private subnets**. They have no public address. Only the load balancer is reachable from the internet, and each layer only accepts traffic from the layer in front of it. Passwords and the token signing key are kept in **AWS Secrets Manager**, not in our code. Logs go to **CloudWatch**.

## 3. Why we chose these services (2 minutes)
- **S3 and CloudFront for the frontend**: our web pages are static files, so we do not need a server. It is cheap, fast, and CloudFront gives HTTPS for free.
- **Fargate for the API**: we wanted to run our Docker container without patching or maintaining servers. We run two copies in two availability zones, so the system keeps working if one fails, and updates roll out with no downtime.
- **RDS for the database**: our app was built for MySQL. RDS is managed MySQL with backups and patching, and we kept it in a private subnet.
- **Application Load Balancer**: it spreads traffic across the two copies and checks `/health` so a broken copy is removed automatically.
- **Secrets Manager**: so no password or key ever sits in GitHub or inside the image.
- **NAT gateway**: our private containers still need to download the image and read secrets. The NAT gateway lets them go out without letting anyone come in.
- **Sydney region**: our free plan blocked Singapore, so we used the nearest allowed region.

## 4. Security in simple words (45 seconds)
Four layers. First, the database and API are private. Second, secrets are in Secrets Manager. Third, PINs are stored only as hashes, login tokens expire after 12 hours, accounts lock after five wrong tries, and admin-only actions are checked on the server. Fourth, our pipeline signs in to AWS with temporary credentials, so there are no access keys stored in GitHub.

## 5. CI/CD (2 minutes)
[Show the GitHub Actions page and `.github/workflows/deploy.yml`.]

We use **GitHub Actions**. We work on the branch `Aws-deployent`. When we push there, the pipeline runs our checks: it installs the backend, checks every JavaScript file for errors, and runs tests if they exist. If a check fails, nothing is deployed.

When we merge into **main**, which is our production branch, the pipeline checks the code again and then deploys only what changed. If the backend changed, it builds the Docker image, pushes it to **ECR**, and tells **ECS** to roll out the new version, then waits until the new containers are healthy. If the frontend changed, it copies the files to S3 and clears the CloudFront cache.

For security we used **OpenID Connect**. GitHub proves its identity to AWS for each run and receives temporary permissions limited to our own repository, ECR, ECS, S3 and CloudFront. No AWS keys are stored in GitHub.

One real problem we solved: our first runs passed the checks but failed to sign in to AWS. We read the AWS CloudTrail log and found that GitHub now includes numeric IDs in its identity token, which our trust policy did not expect. We updated the policy, re-ran the workflow, and all four jobs turned green. We also learned to deploy only from `main`, because two branches deploying to the same site can overwrite each other.

## 6. Honest differences from our design diagram (45 seconds)
We want to be clear about what differs from our original diagram:
- Sydney instead of Singapore, because of the free plan.
- A smaller database (db.t3.micro) with one-day backups, to fit the credits.
- No custom domain, so we use the CloudFront address, which still gives HTTPS.
- Attendance photos are stored in the database instead of a separate S3 bucket.
- The PIN reset is done by the admin, instead of email OTP.
- We added a NAT gateway, which the diagram did not show.
- CloudWatch alarms and a separate staging environment were not built, to stay within the credit budget.

Next steps: restrict the load balancer so it only accepts traffic from CloudFront, add security headers and rate limiting, and add alarms.

## 7. Live demo order (about 2 minutes)
1. [Open the live link.] The site loads over HTTPS from CloudFront.
2. [Log in as admin.] The dashboard shows attendance for today.
3. [Open Staff.] Show Reset PIN, Deactivate and the account status.
4. [Open SOP.] Create an SOP, publish it.
5. [On a phone, open the staff link.] Log in, time in with a photo, then show the photo in the admin Attendance page.
6. [Open GitHub Actions.] Show the green run and the four jobs.
7. [Optional] Make a small text change on a branch, merge to `main`, and show it going live automatically.

## 8. Questions we may be asked
**Why Fargate and not EC2?** We did not want to manage servers. Fargate runs the container directly and scales to two copies easily.

**Why a NAT gateway? It costs money.** The private containers need outbound access to ECR, Secrets Manager and CloudWatch. It is a fixed cost, so we used only one. VPC endpoints would be a cheaper long-term option.

**Why is the database in a private subnet?** So nobody on the internet can connect to it. Only our API can.

**Is the connection from CloudFront to the load balancer encrypted?** Not yet. That hop is inside AWS and uses HTTP, because we do not have a custom domain for a certificate. The user's connection to CloudFront is HTTPS. With a domain we would add HTTPS there too.

**Can someone bypass CloudFront?** Currently the load balancer is public. Locking it to CloudFront is our first planned hardening step.

**How do you roll back?** Run the pipeline for the last good commit. Every Docker image is tagged with its commit, and old images stay in ECR.

**What is not automated?** Database changes (migrations) and creating the infrastructure. We run migrations as a one-off ECS task.

**How do you handle secrets?** Secrets Manager for the database password and token key. GitHub stores no AWS keys.

**What happens when a container crashes?** The load balancer's health check fails, ECS replaces the container, and the other copy keeps serving.
