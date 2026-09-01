---
name: Vercel pnpm workspace builds
description: Vercel can default to npm and frozen installs expose stale workspace lockfiles.
---

Keep Vercel’s install command explicitly on pnpm, pin the workspace package manager, and keep pnpm-lock.yaml synchronized with every package manifest change.

**Why:** This workspace intentionally rejects npm, while Vercel selected npm despite the pnpm lockfile; after that was corrected, the frozen install exposed removed dependencies still recorded in the lockfile.

**How to apply:** Validate the exact Vercel install command with `pnpm install --frozen-lockfile`, then run the artifact-specific build with all required environment variables before publishing.