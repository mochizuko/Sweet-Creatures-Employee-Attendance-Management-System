# CI/CD setup (GitHub Actions to AWS)

Workflow file: `.github/workflows/deploy.yml`

## What it does
1. **Detect changes**: checks whether `backend/**` or `frontend/**` changed.
2. **Check code**: installs backend dependencies, syntax-checks every `.js` file, runs `npm test` if a test script exists.
3. **Deploy backend** (only if backend changed): builds the Docker image, pushes it to ECR (tags: commit SHA and `latest`), forces a new ECS deployment, and waits until the service is stable.
4. **Deploy frontend** (only if frontend changed): syncs `frontend/` to the S3 bucket and invalidates the CloudFront cache.

Authentication uses GitHub OIDC (short-lived credentials). No AWS access keys are stored in GitHub.

## One-time AWS setup (CloudShell)
1. Create the OIDC provider (skip if it already exists):
   `aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com`
2. Edit `github-oidc-trust-policy.json` and replace `YOUR_GITHUB_USER/YOUR_REPO`.
3. Create the role and attach the permissions:
   ```
   aws iam create-role --role-name sweet-creatures-github-deploy --assume-role-policy-document file://github-oidc-trust-policy.json
   aws iam put-role-policy --role-name sweet-creatures-github-deploy --policy-name deploy --policy-document file://github-deploy-permissions.json
   ```
4. In GitHub: Settings > Secrets and variables > Actions > New repository secret.
   Name `AWS_ROLE_ARN`, value `arn:aws:iam::940836045674:role/sweet-creatures-github-deploy`.

## Notes
- Database migrations are not run automatically. Run `node src/scripts/migrate.js` as an ECS task when the schema changes.
- To deploy without a code change, use Actions > CI/CD - Sweet Creatures > Run workflow.
