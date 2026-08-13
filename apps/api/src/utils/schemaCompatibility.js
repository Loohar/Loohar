import { prisma } from "../config/prisma.js";

const REQUIRED_MIGRATIONS = [
  "20260724090000_development_entitlement_simulation",
  "20260802120000_enterprise_pos_workflows",
  "20260804090000_auth_device_sessions"
];
const REQUIRED_MIGRATION = REQUIRED_MIGRATIONS[REQUIRED_MIGRATIONS.length - 1];
const CHECK_TTL_MS = 15_000;

const state = {
  checkedAt: null,
  ok: false,
  issues: [{ code: "SCHEMA_NOT_CHECKED", message: "Database schema compatibility has not been checked yet." }],
  promise: null
};

function publicIssue(issue) {
  return {
    code: issue.code,
    message: issue.message
  };
}

export function schemaCompatibilitySnapshot() {
  return {
    ok: state.ok,
    checkedAt: state.checkedAt,
    requiredMigration: REQUIRED_MIGRATION,
    requiredMigrations: REQUIRED_MIGRATIONS,
    issues: state.issues.map(publicIssue)
  };
}

export async function refreshSchemaCompatibility({ force = false } = {}) {
  const now = Date.now();
  if (!force && state.checkedAt && now - new Date(state.checkedAt).getTime() < CHECK_TTL_MS) {
    return schemaCompatibilitySnapshot();
  }
  if (state.promise) return state.promise;

  const check = (async () => {
    const issues = [];
    try {
    const columnRows = await prisma.$queryRaw`
      SELECT column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Restaurant'
        AND column_name = 'tenantClassification'
      LIMIT 1
    `;
    if (!columnRows.length) {
      issues.push({
        code: "MISSING_RESTAURANT_TENANT_CLASSIFICATION_COLUMN",
        message: "Database is missing Restaurant.tenantClassification. Run the committed Prisma migration before starting this API build."
      });
    }

    const tableRows = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'TenantEntitlementSimulation'
      LIMIT 1
    `;
    if (!tableRows.length) {
      issues.push({
        code: "MISSING_TENANT_ENTITLEMENT_SIMULATION_TABLE",
        message: "Database is missing TenantEntitlementSimulation. Run the committed Prisma migration before starting this API build."
      });
    }

    const authSessionRows = await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'AuthSession'
      LIMIT 1
    `;
    if (!authSessionRows.length) {
      issues.push({
        code: "MISSING_AUTH_SESSION_TABLE",
        message: "Database is missing AuthSession. Run the committed auth device sessions migration before starting this API build."
      });
    }

    const staffColumnRows = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'RestaurantStaff'
        AND column_name IN (
          'locationIdsJson',
          'posPinHash',
          'posPinFailedAttempts',
          'posPinLockedUntil',
          'posPinUpdatedAt',
          'posLastUnlockedAt'
        )
    `;
    const staffColumnNames = new Set(staffColumnRows.map((row) => row.column_name));
    for (const columnName of ["locationIdsJson", "posPinHash", "posPinFailedAttempts", "posPinLockedUntil", "posPinUpdatedAt", "posLastUnlockedAt"]) {
      if (!staffColumnNames.has(columnName)) {
        issues.push({
          code: `MISSING_RESTAURANT_STAFF_${columnName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}_COLUMN`,
          message: `Database is missing RestaurantStaff.${columnName}. Run the committed enterprise POS workflow migration before starting this API build.`
        });
      }
    }

    const orderTypeRows = await prisma.$queryRaw`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'OrderType'
        AND enumlabel IN ('DRIVE_THRU', 'CURBSIDE', 'CATERING')
    `;
    const orderTypeLabels = new Set(orderTypeRows.map((row) => row.enumlabel));
    for (const enumLabel of ["DRIVE_THRU", "CURBSIDE", "CATERING"]) {
      if (!orderTypeLabels.has(enumLabel)) {
        issues.push({
          code: `MISSING_ORDER_TYPE_${enumLabel}`,
          message: `Database is missing OrderType.${enumLabel}. Run the committed enterprise POS workflow migration before starting this API build.`
        });
      }
    }

    const enumRows = await prisma.$queryRaw`
      SELECT typname
      FROM pg_type
      WHERE typname IN ('TenantClassification', 'EntitlementSimulationMode')
    `;
    const enumNames = new Set(enumRows.map((row) => row.typname));
    for (const enumName of ["TenantClassification", "EntitlementSimulationMode"]) {
      if (!enumNames.has(enumName)) {
        issues.push({
          code: `MISSING_${enumName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}_ENUM`,
          message: `Database is missing ${enumName}. Run the committed Prisma migration before starting this API build.`
        });
      }
    }

    for (const migrationName of REQUIRED_MIGRATIONS) {
      const migrationRows = await prisma.$queryRaw`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE migration_name = ${migrationName}
          AND finished_at IS NOT NULL
        LIMIT 1
      `;
      if (!migrationRows.length) {
        issues.push({
          code: "MISSING_REQUIRED_PRISMA_MIGRATION",
          message: `Prisma migration ${migrationName} has not been applied to this database.`
        });
      }
    }
    } catch (error) {
      issues.push({
        code: "SCHEMA_COMPATIBILITY_CHECK_FAILED",
        message: "Database schema compatibility could not be verified."
      });
      console.error("Schema compatibility check failed.", {
        code: error?.code,
        message: error?.message
      });
    }

    state.checkedAt = new Date().toISOString();
    state.ok = issues.length === 0;
    state.issues = issues;
    if (!state.ok) {
      console.error("Database schema is not compatible with this API build.", {
        requiredMigration: REQUIRED_MIGRATION,
        requiredMigrations: REQUIRED_MIGRATIONS,
        issues: state.issues.map(publicIssue)
      });
    }
    return schemaCompatibilitySnapshot();
  })();
  state.promise = check;
  try {
    return await check;
  } finally {
    if (state.promise === check) state.promise = null;
  }
}
