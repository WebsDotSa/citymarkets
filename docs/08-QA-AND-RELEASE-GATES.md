# City Markets — QA & Release Gates

## Blocking
- npm ci
- typecheck
- lint
- unit tests
- integration tests
- migration validation
- contract validation
- build
- critical E2E
- iOS contract smoke

No gate may be bypassed with `|| true`.

## Critical journeys
1. Guest browse -> cart -> checkout
2. OTP customer checkout
3. Moyasar payment
4. Tamara
5. duplicate checkout
6. duplicate webhook
7. stock concurrency
8. vendor isolation
9. admin permissions
10. driver workflow
