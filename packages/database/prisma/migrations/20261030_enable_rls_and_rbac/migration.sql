-- ============================================================================
-- MIGRACIÓN DEVSECOPS: SUPABASE RLS + RBAC MULTI-TENANT (TUTRAGO)
-- Compatible con Prisma (postgres / service_role bypass natural sin bloqueo)
-- ============================================================================

-- 1. Enum UserRole, columnas RBAC en users y campos financieros de Split Payment (Idempotente)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
    CREATE TYPE "UserRole" AS ENUM ('CONSUMER', 'BAR_OPERATOR', 'VENUE_ADMIN', 'INCUBATIO_ADMIN');
  END IF;
END $$;

ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'CONSUMER',
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "assigned_bar_id" TEXT,
  ADD COLUMN IF NOT EXISTS "password_hash" TEXT;

CREATE INDEX IF NOT EXISTS "users_role_tenant_id_idx" ON "public"."users"("role", "tenant_id");
CREATE INDEX IF NOT EXISTS "users_assigned_bar_id_idx" ON "public"."users"("assigned_bar_id");

ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "commission_pct" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  ADD COLUMN IF NOT EXISTS "gateway_fee_pct" DOUBLE PRECISION NOT NULL DEFAULT 4.5,
  ADD COLUMN IF NOT EXISTS "sandbox_mode" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "public"."orders"
  ADD COLUMN IF NOT EXISTS "gateway_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tenant_net_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "applied_commission_pct" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  ADD COLUMN IF NOT EXISTS "applied_gateway_fee_pct" DOUBLE PRECISION NOT NULL DEFAULT 4.5;

ALTER TABLE "public"."order_items"
  ADD COLUMN IF NOT EXISTS "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "item_platform_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "item_gateway_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "item_tenant_net" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2. Habilitar Row Level Security (RLS) en TODAS las tablas de negocio
-- Nota crítica: NO se usa FORCE ROW LEVEL SECURITY para garantizar que el rol
-- propietario de Prisma (postgres) y service_role operen transacciones ACID sin bloqueo.
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."bars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."product_upsells" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."pickup_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."pickup_ticket_items" ENABLE ROW LEVEL SECURITY;

-- 3. Políticas explícitas para service_role / postgres (Backend Prisma & Admin)
DROP POLICY IF EXISTS "service_role_all_users" ON "public"."users";
CREATE POLICY "service_role_all_users" ON "public"."users"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_tenants" ON "public"."tenants";
CREATE POLICY "service_role_all_tenants" ON "public"."tenants"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_bars" ON "public"."bars";
CREATE POLICY "service_role_all_bars" ON "public"."bars"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_products" ON "public"."products";
CREATE POLICY "service_role_all_products" ON "public"."products"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_product_upsells" ON "public"."product_upsells";
CREATE POLICY "service_role_all_product_upsells" ON "public"."product_upsells"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_orders" ON "public"."orders";
CREATE POLICY "service_role_all_orders" ON "public"."orders"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_order_items" ON "public"."order_items";
CREATE POLICY "service_role_all_order_items" ON "public"."order_items"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_pickup_tickets" ON "public"."pickup_tickets";
CREATE POLICY "service_role_all_pickup_tickets" ON "public"."pickup_tickets"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_pickup_ticket_items" ON "public"."pickup_ticket_items";
CREATE POLICY "service_role_all_pickup_ticket_items" ON "public"."pickup_ticket_items"
  FOR ALL TO postgres, service_role USING (true) WITH CHECK (true);

-- 4. Políticas para Clientes Autenticados (CONSUMER / BAR_OPERATOR / VENUE_ADMIN) vía PostgREST
-- Catálogo y Barras activas visibles para lectura de clientes autenticados
DROP POLICY IF EXISTS "authenticated_read_active_bars" ON "public"."bars";
CREATE POLICY "authenticated_read_active_bars" ON "public"."bars"
  FOR SELECT TO authenticated
  USING ("status" = 'ACTIVE' OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('VENUE_ADMIN', 'INCUBATIO_ADMIN', 'BAR_OPERATOR'));

DROP POLICY IF EXISTS "authenticated_read_products" ON "public"."products";
CREATE POLICY "authenticated_read_products" ON "public"."products"
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "operator_update_product_stock" ON "public"."products";
CREATE POLICY "operator_update_product_stock" ON "public"."products"
  FOR UPDATE TO authenticated
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('BAR_OPERATOR', 'VENUE_ADMIN', 'INCUBATIO_ADMIN')
    AND (
      (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'INCUBATIO_ADMIN'
      OR (current_setting('request.jwt.claims', true)::jsonb ->> 'tenantId') = "tenant_id"
    )
  );

DROP POLICY IF EXISTS "authenticated_read_upsells" ON "public"."product_upsells";
CREATE POLICY "authenticated_read_upsells" ON "public"."product_upsells"
  FOR SELECT TO authenticated
  USING (true);

-- Usuarios: Cada usuario solo ve su propio perfil (o Admin de Incubatio)
DROP POLICY IF EXISTS "users_self_select" ON "public"."users";
CREATE POLICY "users_self_select" ON "public"."users"
  FOR SELECT TO authenticated
  USING (
    "id" = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'INCUBATIO_ADMIN'
  );

-- Órdenes: CONSUMER solo ve sus propias órdenes; VENUE_ADMIN ve las de su boliche
DROP POLICY IF EXISTS "orders_consumer_and_admin_select" ON "public"."orders";
CREATE POLICY "orders_consumer_and_admin_select" ON "public"."orders"
  FOR SELECT TO authenticated
  USING (
    "user_id" = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    OR (
      (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'VENUE_ADMIN'
      AND "tenant_id" = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenantId')
    )
    OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'INCUBATIO_ADMIN'
  );

-- OrderItems: CONSUMER solo ve ítems de sus propias órdenes
DROP POLICY IF EXISTS "order_items_owner_select" ON "public"."order_items";
CREATE POLICY "order_items_owner_select" ON "public"."order_items"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "public"."orders" o
      WHERE o."id" = "order_items"."order_id"
      AND (
        o."user_id" = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
        OR (
          (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'VENUE_ADMIN'
          AND o."tenant_id" = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenantId')
        )
        OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'INCUBATIO_ADMIN'
      )
    )
  );

-- PickupTickets: CONSUMER ve tickets de sus órdenes; BAR_OPERATOR solo opera su barra asignada
DROP POLICY IF EXISTS "pickup_tickets_access_policy" ON "public"."pickup_tickets";
CREATE POLICY "pickup_tickets_access_policy" ON "public"."pickup_tickets"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "public"."orders" o
      WHERE o."id" = "pickup_tickets"."order_id"
      AND o."user_id" = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    )
    OR (
      (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'BAR_OPERATOR'
      AND "bar_id" = (current_setting('request.jwt.claims', true)::jsonb ->> 'assignedBarId')
    )
    OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('VENUE_ADMIN', 'INCUBATIO_ADMIN')
  );

DROP POLICY IF EXISTS "pickup_tickets_operator_update" ON "public"."pickup_tickets";
CREATE POLICY "pickup_tickets_operator_update" ON "public"."pickup_tickets"
  FOR UPDATE TO authenticated
  USING (
    (
      (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'BAR_OPERATOR'
      AND "bar_id" = (current_setting('request.jwt.claims', true)::jsonb ->> 'assignedBarId')
    )
    OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('VENUE_ADMIN', 'INCUBATIO_ADMIN')
  );

-- 5. Asegurar WITH (security_invoker = on) en todas las vistas públicas existentes y vista pública segura de Tenants
CREATE OR REPLACE VIEW "public"."v_public_tenants"
WITH (security_invoker = on) AS
SELECT
  "id",
  "name",
  "slug",
  "is_active",
  "created_at"
FROM "public"."tenants"
WHERE "is_active" = true;

DO $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT table_schema, table_name
    FROM information_schema.views
    WHERE table_schema = 'public'
  LOOP
    EXECUTE format('ALTER VIEW %I.%I SET (security_invoker = on)', v_rec.table_schema, v_rec.table_name);
  END LOOP;
END $$;

