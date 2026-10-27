-- Operational idempotency token for repeated delivery submissions.
ALTER TABLE learning.entrega ADD COLUMN clave_idempotencia uuid;
CREATE UNIQUE INDEX entrega_idempotency_uq ON learning.entrega(ejecucion_id,clave_idempotencia);