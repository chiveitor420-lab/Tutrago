import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALLOWED_SUPABASE_PROJECT_REF = 'hwnjpulqucvdbhysgesh';
const ALLOWED_SUPABASE_POOLER_HOST = 'aws-0-us-east-2.pooler.supabase.com';

function validateSupabaseConnectionUrl(url, varName) {
  if (!url) return false;
  const lower = url.toLowerCase();
  const isSupabase = lower.includes('supabase.com') || lower.includes('supabase.co');
  if (!isSupabase) return false;

  if (!lower.includes(ALLOWED_SUPABASE_PROJECT_REF)) {
    throw new Error(
      `[Seguridad DB] ${varName} apunta a un proyecto de Supabase no autorizado. ` +
        `Solo se permite exclusivamente el proyecto real "${ALLOWED_SUPABASE_PROJECT_REF}" (${ALLOWED_SUPABASE_POOLER_HOST}).`
    );
  }
  return true;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || '';
  const directUrl = process.env.DIRECT_URL || '';

  const isProdSupabase =
    validateSupabaseConnectionUrl(dbUrl, 'DATABASE_URL') ||
    validateSupabaseConnectionUrl(directUrl, 'DIRECT_URL');

  if (!isProdSupabase) {
    console.log(
      '[sync-prod-db] Sin conexión activa a Supabase hwnjpulqucvdbhysgesh en este entorno. Omitiendo prisma db push remoto.'
    );
    return;
  }

  console.log(
    `[sync-prod-db] Conexión verificada hacia el proyecto real Supabase: ${ALLOWED_SUPABASE_PROJECT_REF} (${ALLOWED_SUPABASE_POOLER_HOST})`
  );

  // 1. Ejecutar prisma db push para sincronizar el schema.prisma con producción
  try {
    console.log('[sync-prod-db] Ejecutando: npx prisma db push --skip-generate --accept-data-loss...');
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      timeout: 30000,
      env: {
        ...process.env,
        DIRECT_URL: directUrl || dbUrl,
      },
    });
    console.log('[sync-prod-db] prisma db push aplicado exitosamente.');
  } catch (err) {
    console.warn(
      `[sync-prod-db] Aviso en prisma db push (continuando con sincronización SQL idempotente): ${err.message}`
    );
  }

  // 2. Aplicar migration.sql (Columnas financieras + RBAC + Políticas RLS de Supabase)
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const migrationPath = join(
      __dirname,
      'migrations',
      '20261030_enable_rls_and_rbac',
      'migration.sql'
    );
    const rawSql = readFileSync(migrationPath, 'utf8');

    const wrappedBlock = `
DO $tutrago_prod_migration$
BEGIN
${rawSql}
END
$tutrago_prod_migration$;
    `;

    await prisma.$executeRawUnsafe(wrappedBlock);
    console.log(
      '[sync-prod-db] Migración SQL (campos Split Payment + RBAC + RLS) aplicada con éxito en hwnjpulqucvdbhysgesh.'
    );
  } catch (err) {
    console.warn(`[sync-prod-db] Aviso al aplicar bloque SQL: ${err.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[sync-prod-db] Error crítico:', err.message);
  process.exit(1);
});
