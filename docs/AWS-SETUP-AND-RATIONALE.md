# AWS Setup and Why We Chose It

Sweet Creatures Attendance and Payroll System. Region: **ap-southeast-2 (Sydney)**. Prepared: November 26, 2026.

## 1. What runs where

```
Staff phone / Admin browser
        |  HTTPS
        v
Amazon CloudFront (E3T9UNN9V7TOF7)
   |-- default behavior  -->  S3 bucket (private)  : admin app + staff PWA files
   |-- /api/*            -->  Application Load Balancer (public subnets)
                                   |  HTTP :3000, health check /health
                                   v
                         ECS Fargate service, 2 tasks (private subnets, 2 zones)
                                   |  MySQL :3306
                                   v
                         Amazon RDS MySQL (private DB subnets)

Also used by the API: Secrets Manager (DB password, JWT key), CloudWatch Logs.
Release path: GitHub -> GitHub Actions -> ECR (image) -> ECS, and GitHub Actions -> S3 -> CloudFront.
```

## 2. Components and the reason for each choice

| Component | Our setup | Why we chose it |
|---|---|---|
| **VPC** `sweet-creatures-vpc` (10.0.0.0/16) | 2 availability zones, 2 public subnets, 4 private subnets (2 for the API, 2 for the database) | Puts the database and API where the internet cannot reach them directly. Two zones means one zone can fail without taking the system down |
| **NAT gateway** | 1 gateway in a public subnet | The API containers sit in private subnets but must reach ECR (to pull the image), Secrets Manager and CloudWatch. A NAT gateway gives them outbound-only internet access. It is a fixed cost, so we used one instead of one per zone |
| **S3 bucket** `sweet-creatures-web-940836045674` | Private, accessed only through CloudFront using Origin Access Control (`sc-web-oac`) | Static files (HTML, CSS, JS) need no server. S3 is cheap and durable. Keeping it private means nobody can bypass CloudFront |
| **CloudFront** | Default behavior to S3, `/api/*` to the load balancer, caching disabled for the API | Gives us HTTPS with the free CloudFront certificate, fast delivery, and a single address for both the web app and the API (so the browser makes no cross-origin calls) |
| **Application Load Balancer** `sc-alb` | Public subnets, HTTP :80 to target group `sc-api-tg` (port 3000), health path `/health` | Spreads requests across the 2 API tasks and removes an unhealthy task automatically |
| **ECS on Fargate** | Cluster `sweet-creatures-cluster`, service `sweet-creatures-api-service-zkj8co1t`, task definition `sweet-creatures-api`, 0.5 vCPU, 1 GB, port 3000, 2 tasks | Runs our Docker container without managing any servers. Two tasks give availability and zero-downtime rolling updates. The size is enough for this workload and keeps cost low |
| **ECR** `sweet-creatures-api` | Private image registry | Stores the API image that ECS pulls. Integrates with IAM and with our pipeline |
| **RDS MySQL** `sweet-creatures-db` | MySQL 8.4, db.t3.micro, single zone, database `sweet_creatures`, private DB subnets, backups kept 1 day | The app was written for MySQL. RDS handles patching and backups. The security group allows connections only from the API's security group |
| **Secrets Manager** | `sc/db-password`, `sc/jwt-secret` | The database password and the token-signing key are never in the code or the image. ECS injects them at start-up through the task execution role (`sc-ecs-task-execution-role`) |
| **CloudWatch Logs** | Log group `/ecs/sweet-creatures-api`, 1 week retention | Container output is kept for troubleshooting. We used it to read the migration and seed results |
| **Security groups** | `sc-alb-sg` (internet to load balancer), `sc-ecs-sg` (only the load balancer to the API), `sc-rds-sg` (only the API to the database) | Each layer accepts traffic only from the layer in front of it |
| **IAM (GitHub OIDC role)** | Role `sweet-creatures-github-deploy` | Lets GitHub Actions deploy with short-lived credentials. No AWS access keys are stored anywhere |

## 3. Security design
- **Network layering**: public load balancer, private API, private database. The database has no public address.
- **Secrets**: stored in Secrets Manager, not in Git, the image or environment files.
- **Authentication**: PINs are stored as bcrypt hashes. Tokens (JWT) expire after 12 hours. Accounts lock after 5 failed PIN attempts. Admin-only routes check the role on the server.
- **Least privilege in the pipeline**: the deploy role can only push to our ECR repository, redeploy our ECS service, write to our S3 bucket and invalidate our CloudFront distribution.
- **Private storage**: the website bucket cannot be opened directly. Only CloudFront can read it.

## 4. Where we differ from the original design diagram

| Original diagram | What we built | Reason |
|---|---|---|
| Region Singapore (ap-southeast-1) | Sydney (ap-southeast-2) | The AWS free plan blocked Singapore |
| RDS db.t3.small, 20 GB, 7-day backups | db.t3.micro, 1-day backups | Free-plan limits and credit budget |
| MySQL 8 | MySQL 8.4 | Current supported minor version |
| Route 53 and ACM custom domain | CloudFront default domain and certificate | HTTPS is still provided, with no domain purchase |
| HTTPS between load balancer and API | HTTP from CloudFront to the load balancer | No custom domain means no certificate for the load balancer. This hop is inside AWS |
| No NAT gateway shown | 1 NAT gateway | Required for private containers to reach ECR, Secrets Manager and CloudWatch |
| S3 bucket for attendance photos | Photos stored in the database as compressed JPEG data | Fewer moving parts for the deadline. The trade-off is a larger database over time |
| SES for OTP recovery emails | Admin-initiated PIN reset | Email sending needs verified senders and extra code. Admin reset is simpler and safer for a small team |
| CloudWatch alarms | Logs only | Alarms were an optional extra and were not set up |
| Separate prod (`main`) and staging (`develop`) | One production environment. `Aws-deployent` runs checks only. Merging into `main` deploys | Single environment to stay within the credit budget |

## 5. Cost control
- Free-plan credits of 120 USD with a 20 USD budget alert.
- The API can be stopped by setting the ECS desired count to 0, and the database can be stopped, between demos.
- The load balancer and NAT gateway cannot be paused, and are the main running cost (about 2.50 USD per day).
- After grading, all resources are deleted to stop billing.

## 6. Known limitations and next steps
Not applied at the time of writing:
1. **Lock the load balancer to CloudFront**: restrict `sc-alb-sg` so the API cannot be reached directly over HTTP, only through CloudFront.
2. **Security headers and rate limiting**: add `helmet` and a rate limiter in the Express server, and restrict CORS to the CloudFront domain.
3. **CloudWatch alarms** for API errors and database CPU.
4. **Longer database backups and a multi-zone database** for production use.
5. **Database migrations are run manually** as an ECS task (`node src/scripts/migrate.js`) when the schema changes.
