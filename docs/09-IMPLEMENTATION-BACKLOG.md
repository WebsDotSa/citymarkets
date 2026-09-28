# City Markets — Implementation Backlog

## P0
- [ ] remove production DB debug leakage
- [ ] establish payment event/idempotency model
- [ ] reconcile schema drift
- [ ] verify stock concurrency
- [ ] verify auth/vendor/admin isolation
- [ ] make CI blocking

## P1
- [ ] create domain modules
- [ ] create v2 contracts
- [ ] extract CheckoutService
- [ ] extract PaymentService
- [ ] canonicalize catalog/product model
- [ ] unify actor/auth layer
- [ ] queue critical notifications
- [ ] remove local filesystem coupling

## P2
- [ ] consolidate routes/components
- [ ] remove auth aliases after consumer audit
- [ ] remove unused dependencies
- [ ] shared design system
- [ ] performance/caching review

## P3
- [ ] non-critical polish
- [ ] naming/documentation cleanup
