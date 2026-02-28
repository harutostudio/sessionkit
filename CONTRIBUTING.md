# Contributing

Thanks for contributing to SessionKit.

## Prerequisites

- Node.js 22+
- pnpm 10+

## Setup

```bash
pnpm install
```

## Local Checks

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm docs:build
```

All checks should pass before opening a pull request.

## Commit Convention

Use Conventional Commits, for example:
- `chore(core): ...`
- `fix(redis): ...`
- `feat(express): ...`

Commit body should use bullet lines:
- `- ...`

## Versioning and Release Notes

This monorepo uses Changesets.

When your change affects published packages, add a changeset:

```bash
pnpm changeset
```

## Pull Requests

Include:
- what changed
- why it changed
- migration notes (if behavior changed)
- test updates (if applicable)
