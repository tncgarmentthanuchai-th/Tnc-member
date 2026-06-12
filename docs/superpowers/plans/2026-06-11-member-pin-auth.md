# Member PIN Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure phone-and-PIN member login, self-service profile management, and admin temporary PIN reset.

**Architecture:** Keep Google Sheets as storage, add pure auth primitives for testability, and expose member APIs through the existing Apps Script web app. Use HMAC signed stateless sessions and `sessionVersion` for revocation.

**Tech Stack:** Google Apps Script V8, Google Sheets, Vanilla HTML/CSS/JS, Node test runner

---

### Task 1: Auth primitives and service behavior

- [ ] Add failing tests for PIN validation/hash verification and signed session tokens.
- [ ] Implement pure PIN/session helpers and run tests green.
- [ ] Add failing member-service tests for login, forced change, profile edits, phone change, and PIN reset.
- [ ] Implement service behavior and run all tests.

### Task 2: Sheet schema and Apps Script APIs

- [ ] Extend member schema and migration without deleting existing rows.
- [ ] Add server-side secret, rate limiting, session verification, member APIs, and admin reset API.
- [ ] Ensure API responses never expose auth fields.

### Task 3: Public, Member, and Admin UI

- [ ] Require PIN confirmation during new registration.
- [ ] Add `?page=member` login and account-management UI using `sessionStorage`.
- [ ] Add one-time temporary PIN reset action to Admin.
- [ ] Keep safe DOM rendering and responsive behavior.

### Task 4: Migration, deployment, and verification

- [ ] Run automated tests and static security checks.
- [ ] Push source, run schema migration, and update Public/Admin deployments while preserving URLs.
- [ ] Verify Public registration, Member login route, Admin reset control, and Sheet schema.
