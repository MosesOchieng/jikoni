---
name: Native SQLite compatibility
description: Why the imported API uses a small callback-compatible adapter around Node's built-in SQLite implementation.
---

When a Replit package firewall blocks the native sqlite3 dependency, keep the existing callback-based data access surface and adapt it to Node's built-in SQLite rather than replacing the app's database.

**Why:** The imported API already depends on SQLite semantics, while the blocked native package can leave the workflow unable to start. Node's built-in implementation avoids that installation failure and preserves the existing route behavior.

**How to apply:** Confirm the runtime supports `node:sqlite`, preserve callback results such as `lastID`, and keep the adapter isolated so a future database migration can remove it cleanly.