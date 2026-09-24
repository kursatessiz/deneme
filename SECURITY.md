# Security Policy

## Reporting a vulnerability

Do not open a public issue for security problems. Use GitHub's private
vulnerability reporting instead: the "Report a vulnerability" button under
the repository's Security tab. You will get a reply within 5 working days.

Please include the affected component (api, web, mobile, deploy), steps to
reproduce, and the impact you expect (for example cross-tenant data access).

## Supported versions

Only the latest release on `main` receives fixes.

## What is in place

- Dependency updates by Dependabot with a 7-day cooldown; majors as separate PRs
- `pnpm audit` (high and above), dependency review and license checks on every PR
- CodeQL (security-extended) for TypeScript and GitHub Actions
- Secret scanning (TruffleHog) and workflow auditing (zizmor, actionlint)
- OpenSSF Scorecard
- Container images with build provenance attestations and SBOMs, running as a
  non-root user on a read-only filesystem
