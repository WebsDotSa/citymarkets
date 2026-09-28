# City Markets — AI/Agent Engineering Rules

## Before editing
1. Read the master plan.
2. Inspect the current implementation and tests.
3. Search all consumers.
4. Identify the canonical implementation.
5. Check schema/migration impact.
6. Check iOS/API consumers for contract changes.

## During editing
- Modify canonical code instead of creating duplicates.
- Do not create a second helper/route/component for an existing responsibility.
- No compatibility layer without a sunset condition.
- Business rules belong in domain services.
- SQL belongs in repositories.
- Provider code belongs in infrastructure adapters.
- UI remains thin.
- Validate all external input.
- Never expose secrets/internal DB errors.

## After editing
Run typecheck, lint, targeted tests, full tests, build, contract/E2E checks, and update docs/backlog.
