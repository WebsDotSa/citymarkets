# City Markets — Rollout Checklist

## Before staging
- [ ] backup verified
- [ ] restore verified
- [ ] schema drift approved
- [ ] v2 contracts frozen
- [ ] provider sandbox tests pass
- [ ] iOS contract smoke passes

## Staging
- [ ] realistic data
- [ ] guest/customer/vendor/admin/driver E2E
- [ ] concurrency tests
- [ ] webhook replay
- [ ] failure injection
- [ ] monitoring verified

## Production
- [ ] canary
- [ ] error/payment/order/inventory monitoring
- [ ] rollback trigger

## Legacy retirement
- [ ] v1 traffic removed
- [ ] old auth consumer removed
- [ ] legacy product writes removed
- [ ] local storage writes removed
