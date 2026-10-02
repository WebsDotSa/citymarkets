# 008 — column-type-mismatches

## Question
**Theory**: If a column is `text` but stores UUIDs or ints, the
planner can't use a btree index for `WHERE col = $1::uuid` because
the column type doesn't match. Look for text columns with uuid-shaped
names that should be typed.

## Approach
1. List every `text` column whose name suggests it should be a
   structured type (uuid/int/date), AND has no enum/check
   constraint, AND is in a public table
2. Cross-reference with the indexes that include it — does the
   index only have a btree expression, or is the column used in
   a non-expression way?

## Query
See `query.sql`.

## Raw output
```
tbl|col|type|in_index
admin_audit_logs|entity_id|text|0
admin_audit_logs|ip_address|text|0
admin_notification_reads|notification_id|text|2
admin_users|email|text|0
admin_users|phone|text|0
analytics_events|session_id|text|1
contact_messages|email|text|0
contact_messages|phone|text|0
job_applications|email|text|0
job_applications|job_id|text|1
job_applications|phone|text|0
native_push_tokens|bundle_id|text|0
orders_refunds|gateway_invoice_id|text|1
page_views|session_id|text|2
payment_events|invoice_id|text|1
users|email|text|0
vendor_orders|moyasar_payment_id|text|0
vendor_staff|email|text|0
vendors|slug|text|2
...
```

## Analysis
Most of these are **legitimate text**:
- emails, phones, slugs, session_ids — free-text by nature
- `admin_audit_logs.entity_id` — polymorphic (can reference any
  table), intentionally text
- `ip_address` — could be `inet` but IPv4 + IPv6 mixed → text is fine
- `bundle_id`, `moyasar_payment_id`, `gateway_invoice_id` — vendor-
  specific opaque strings

The ones that look suspect:
- `admin_notification_reads.notification_id` — has 2 indexes. Let me
  check if it's a UUID-shaped value.

## Verdict: **DISPROVED**
No real type mismatch. The text columns are either free-form or
intentionally polymorphic. The "in_index > 0" rows all have legit
expression or btree indexes that work on the text type.

## Recommendation
None. Keep the spike query for future re-check.
