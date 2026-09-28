-- 046: إصلاح مرساة الـ idempotency للولاء + بذر الإعدادات.
-- 026 مُسجَّلة كمُطبَّقة لكن الفهرس غير موجود على القاعدة الحية،
-- وحتى نصّها الأصلي كان فهرساً جزئياً لا يستنتجه ON CONFLICT.

BEGIN;

DROP INDEX IF EXISTS uq_loyalty_tx_ref_order_type;

-- إبطال ارتباط أي صفوف مكرّرة بدل حذفها (حفاظاً على سجل التدقيق).
-- Postgres يعتبر NULLs متمايزة، فالفهرس الفريد يقبلها.
-- على القاعدة الحية هذا no-op (لا يوجد صف بـ ref_order_id غير فارغ).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY ref_order_id, type ORDER BY created_at, id
         ) AS rn
  FROM loyalty_transactions
  WHERE ref_order_id IS NOT NULL
)
UPDATE loyalty_transactions lt
   SET ref_order_id = NULL
  FROM ranked r
 WHERE lt.id = r.id AND r.rn > 1;

-- فهرس غير جزئي — هذا ما يستنتجه ON CONFLICT (ref_order_id, type)
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_tx_ref_order_type
  ON loyalty_transactions (ref_order_id, type);

INSERT INTO app_settings (key, value) VALUES
  ('loyalty', '{
    "enabled": true,
    "earn_points_per_sar": 0.1,
    "redeem_value_per_point": 0.05,
    "min_redeem_points": 100,
    "max_redeem_percent": 0.5
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
