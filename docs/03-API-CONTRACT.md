# City Markets — API v2 Contract

## Success
```json
{"success":true,"data":{},"request_id":"..."}
```

## Error
```json
{"success":false,"error":{"code":"stable.machine.code","message":"رسالة مناسبة للمستخدم","details":{}},"request_id":"..."}
```

## Rules
- Zod validates every request.
- Public/mobile responses have stable schemas.
- Never expose SQL, stack traces, DB driver errors or provider secrets.
- Authenticated routes resolve actor from trusted session/token.
- Sensitive mutations require permission and audit logging.
- High-volume lists prefer cursor pagination.
- Order/payment creation uses idempotency keys.
- Webhooks have separate auth and replay protection.

## Versioning
- v1 is compatibility-only.
- v2 is canonical.
- Remove v1 only after consumer inventory and telemetry prove migration.
