import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const seedScript = readFileSync(join(root, "apps/api/prisma/seed-development-pos-menu.js"), "utf8");
const setupScript = readFileSync(join(root, "apps/api/prisma/setup-development-pos.js"), "utf8");
const bootstrapScript = readFileSync(join(root, "apps/api/prisma/bootstrap-dev-owner.js"), "utf8");
const apiPackageJson = JSON.parse(readFileSync(join(root, "apps/api/package.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = [];

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function assertCheck(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

const categoryMatch = seedScript.match(/const categories = \[([\s\S]*?)\];/);
const categoryCount = categoryMatch ? (categoryMatch[1].match(/"[^"]+"/g) || []).length : 0;
const itemMatch = seedScript.match(/const items = \[([\s\S]*?)\];/);
const itemCount = itemMatch ? (itemMatch[1].match(/\["/g) || []).length : 0;

assertCheck(packageJson.scripts?.["test:development-menu-seed"]?.includes("development-pos-menu-seed-test.mjs"), "Development POS menu seed release test is registered");
assertCheck(packageJson.scripts?.["seed:development-pos-menu"]?.includes("npm --workspace apps/api run seed:development-pos-menu"), "Root development POS menu seed command delegates to API workspace");
assertCheck(apiPackageJson.scripts?.["seed:development-pos-menu"]?.includes("seed-development-pos-menu.js"), "API development POS menu seed command is registered");

assertCheck(includesAll(seedScript, [
  "REQUIRED_CLASSIFICATION = \"INTERNAL_DEVELOPMENT\"",
  "DEVELOPMENT_POS_SLUG",
  "DEVELOPMENT_POS_RESTAURANT_ID",
  "ALLOW_PRODUCTION_DEVELOPMENT_POS_MENU_SEED",
  "productionGuard()",
  "Refusing to seed the development POS menu in production"
]), "Seed script is explicitly scoped to internal development and guarded in production");

assertCheck(includesAll(seedScript, [
  "tenantClassification: REQUIRED_CLASSIFICATION",
  "Expected exactly one",
  "findMany",
  "restaurants.length !== 1"
]), "Seed script refuses ambiguous or non-development tenants");

assertCheck(categoryCount >= 15 && itemCount >= 40, "Seed script creates a broad POS menu with many categories and items");
assertCheck(includesAll(seedScript, [
  "modifierTemplates",
  "required: true",
  "minSelect",
  "maxSelect",
  "replaceModifierGroups",
  "menuItemOptionGroup.create",
  "menuItemOption.create"
]), "Seed script creates realistic required and optional modifier groups");

assertCheck(includesAll(seedScript, [
  "featured",
  "recommended",
  "available: false",
  "imageUrl"
]), "Seed data includes featured, recommended, unavailable, and image-backed menu examples");

assertCheck(includesAll(seedScript, [
  "development.pos_menu.seeded",
  "internalDevelopmentOnly: true",
  "categoryCount",
  "modifierGroupCount",
  "modifierOptionCount",
  "timeout: 30000"
]), "Seed script records a non-billing audit log and runs in a bounded transaction");

assertCheck(includesAll(`${bootstrapScript}\n${setupScript}`, [
  "INTERNAL_DEVELOPMENT",
  "Development Restaurant",
  "POS_REGISTER",
  "POS_KIOSK_MODE",
  "internalDevelopment"
]) && includesAll(setupScript, [
  "Refusing to modify",
  "tenantClassification",
  "kioskModeEnabled: true",
  "Development Main Terminal",
  "development.pos_fixture.updated"
]), "Development POS setup creates an internal tenant with POS and kiosk capabilities");

if (failures.length) {
  console.error(`development-pos-menu-seed-test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("development-pos-menu-seed-test passed.");
