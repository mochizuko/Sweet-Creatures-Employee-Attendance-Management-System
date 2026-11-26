# CI/CD Process

Tool: **GitHub Actions**. Workflow file: `.github/workflows/deploy.yml`. Prepared: November 26, 2026.

## 1. Flow

```
Developer pushes to Aws-deployent or opens a pull request into main (checks only);
        merging into main also deploys
        |
        v
GitHub Actions starts the workflow
        |
        v
[1] Detect changes   -> did backend/** or frontend/** change?
        |
        v
[2] Check code       -> install backend dependencies, syntax-check every .js file, run npm test (if defined)
        |                     (if this fails, nothing is deployed)
        +--> backend changed?  [3] Deploy backend:
        |        sign in to AWS (OIDC) -> build Docker image -> push to ECR (commit SHA tag + latest)
        |        -> force new ECS deployment -> wait until the service is stable
        |
        +--> frontend changed? [4] Deploy frontend:
                 sign in to AWS (OIDC) -> aws s3 sync frontend/ to the S3 bucket -> CloudFront invalidation /*
```

**Branch rules**
- Push to `Aws-deployent`: runs "Detect changes" and "Check code" only. Nothing is deployed.
- Pull request into `main`: runs the same checks.
- Merge (push) into `main`: runs the checks, then deploys whichever part changed. `main` is production, so there is always one source of truth for what is live.
- Manual run (Actions, "Run workflow", choose `main`): deploys both parts. The button appears once the workflow file is on the default branch.

## 2. What each job does

| Job | Purpose | Details |
|---|---|---|
| Detect changes | Avoid needless deployments | Uses `dorny/paths-filter` to see whether `backend/**` or `frontend/**` changed |
| Check code | Stop broken code reaching production | Node 20. `npm ci` (or `npm install`), `node --check` on every backend and frontend `.js` file, `npm test --if-present` |
| Deploy backend | Release the API | Builds `backend/` into an image, tags it with the commit SHA and `latest`, pushes both to ECR, runs `aws ecs update-service --force-new-deployment`, then `aws ecs wait services-stable` |
| Deploy frontend | Release the web apps | `aws s3 sync frontend s3://sweet-creatures-web-940836045674/ --exclude "*.md"`, then `aws cloudfront create-invalidation --paths "/*"` |

## 3. How the pipeline signs in to AWS
- It uses **OpenID Connect (OIDC)**. For each run GitHub issues a signed token and AWS exchanges it for temporary credentials for the role `sweet-creatures-github-deploy`.
- **No AWS access keys are stored in GitHub.** The only repository secret is `AWS_ROLE_ARN` (the role's address, not a password).
- The role's trust policy only accepts tokens from our repository `mochizuko/Sweet-Creatures-Employee-Attendance-Management-System`.
- Its permissions are limited to our ECR repository, ECS service, S3 bucket and CloudFront distribution.

## 4. Safety features
- **Tests first**: deploy jobs run only after "Check code" passes.
- **Targeted deployments**: only the part that changed is released.
- **Rolling ECS update**: the new tasks start and pass health checks before the old tasks stop, so the API stays available.
- **Waits for stability**: the job fails if the new tasks do not become healthy.
- **One deployment at a time**: a `concurrency` rule on each deploy job prevents two runs from deploying the same part together.
- **Single deploy source**: only `main` can deploy, so a branch can never overwrite what is live.
- **Traceable images**: every image is tagged with the Git commit that built it.

## 4a. Rolling back
Open the last good commit in GitHub and run the workflow for it (or revert the bad commit and push). The pipeline rebuilds and redeploys that version. The previous images remain in ECR under their commit SHA tags.

## 5. What is still manual
- **Database migrations**: run `node src/scripts/migrate.js` as an ECS task when the schema changes.
- **Secrets**: created once in Secrets Manager.
- **Infrastructure** (VPC, RDS, load balancer, CloudFront): created once in the AWS console. It is not defined as code.

## 6. Difference from the original design diagram
The diagram shows `main` (production) and `develop` (staging) branches with lint, unit tests, Docker build and deploy. We implemented the same stages (syntax check in place of a linter, tests when present, Docker build, deploy). `main` deploys to production. Our working branch `Aws-deployent` runs the checks only and is merged into `main` to release. A separate staging environment was left out to stay within the AWS credit budget.

## 7. Verified run and lessons learned
- The first two runs passed "Detect changes" and "Check code", but both deploy jobs failed at the AWS sign-in step: `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
- AWS CloudTrail showed the cause. GitHub's token subject now contains numeric IDs (`repo:mochizuko@182063318/Sweet-Creatures-...@1449057664:ref:refs/heads/Aws-deployent`), and our trust policy expected the older format.
- After updating the role's trust policy to accept both formats and re-running, **all four jobs finished green**.
- To see how the setup was done, read `docs/cicd/README.md`. The IAM policy files are in `docs/cicd/`.
