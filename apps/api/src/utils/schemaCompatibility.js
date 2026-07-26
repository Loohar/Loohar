import { prisma } from "../config/prisma.js";

const REQUIRED_MIGRATION = "20260724090000_development_entitlement_simulation";
const CHECK_TTL_MS = 15_000;

const state = {
  checkedAt: null,
  ok: false,
  issues: [{ code: "SCHEMA_NOT_CHECKED", message: "Database schema compatibility has not been checked yet." }]
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
    issues: state.issues.map(publicIssue)
  };
}

export async function refreshSchemaCompatibility({ force = false } = {}) {
  const now = Date.now();
  if (!force && state.checkedAt && now - new Date(state.checkedAt).getTime() < CHECK_TTL_MS) {
    return schemaCompatibilitySnapshot();
  }

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

    const migrationRows = await prisma.$queryRaw`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE migration_name = ${REQUIRED_MIGRATION}
        AND finished_at IS NOT NULL
      LIMIT 1
    `;
    if (!migrationRows.length) {
      issues.push({
        code: "MISSING_REQUIRED_PRISMA_MIGRATION",
        message: `Prisma migration ${REQUIRED_MIGRATION} has not been applied to this database.`
      });
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
      issues: state.issues.map(publicIssue)
    });
  }
  return schemaCompatibilitySnapshot();
}
