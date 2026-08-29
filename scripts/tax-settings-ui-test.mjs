import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const app = read("apps/web/src/App.jsx");
const packageJson = JSON.parse(read("package.json"));

const helperStart = app.indexOf("const taxCategoryReviewBlockingStatuses");
const helperEnd = app.indexOf("function planFor");
const taxSectionStart = app.indexOf('id="settings-taxes"');
const taxSectionEnd = app.indexOf('{showSettingsSection("payments")');

assert.ok(helperStart > 0 && helperEnd > helperStart, "Tax category review helpers must be defined near tax status helpers");
assert.ok(taxSectionStart > 0 && taxSectionEnd > taxSectionStart, "Tax Settings panel must remain discoverable");

const helpers = app.slice(helperStart, helperEnd);
const taxSection = app.slice(taxSectionStart, taxSectionEnd);
const componentHelpers = app.slice(app.indexOf("function taxProfileFingerprint"), helperEnd);

assert.equal(packageJson.scripts["test:tax-settings-ui"], "node scripts/tax-settings-ui-test.mjs", "Focused tax settings UI test must be runnable directly");
assert.ok(packageJson.scripts.test.includes("test:tax-settings-ui"), "Full npm test must include the focused tax settings UI test");

assert.ok(helpers.includes('"CATEGORY_RULE_REQUIRED"'), "CATEGORY_RULE_REQUIRED must remain an explicit review state");
assert.ok(helpers.includes('label: "Category review required"'), "CATEGORY_RULE_REQUIRED must render a readable owner/admin label");
assert.ok(helpers.includes("Your location and general tax rate have been verified"), "Category review copy must distinguish verified location/general rate");
assert.ok(helpers.includes("Review special or exempt product/category treatment before activation."), "Category review copy must explain product/category follow-up");

assert.ok(helpers.includes('return "Location verified by Colorado TTR"'), "Colorado TTR location verification must be shown separately");
assert.ok(taxSection.includes("Location verification"), "Tax profile detail must include a separate location verification row");
assert.ok(taxSection.includes("Product/category treatment"), "Tax profile detail must rename category safety to product/category treatment");

assert.ok(taxSection.includes("[reviewTaxProfile, activeTaxProfile, ...(location.history || [])]"), "Main summary must consider category-blocked history entries");
assert.ok(taxSection.includes('role="status"') && taxSection.includes('aria-live="polite"'), "Main category review notice must be visible and announced");
assert.ok(taxSection.includes("categoryBlocksActivation") && taxSection.includes("disabled={categoryBlocksActivation"), "Activation UI must remain blocked for category-review candidates");
assert.ok(taxSection.includes('Category review required" : savingTaxAction'), "Blocked activation button must explain the category review state");

assert.ok(taxSection.includes("taxCategoryReviewState(profile)"), "Profile history must evaluate each profile category state");
assert.ok(taxSection.includes("historyCategoryState.label"), "Profile history must render readable category state labels");
assert.ok(taxSection.includes("taxLocationVerificationLabel(profile)"), "Profile history must retain provider/location provenance");

assert.ok(taxSection.includes('readable(location.status || "UNCONFIGURED")'), "Location status such as REFRESH_REQUIRED must remain distinguishable");
assert.ok(app.includes('if (status === "ACTIVE") return "good";'), "ACTIVE tax status must keep its non-warning tone");
assert.ok(helpers.includes('if (categoryStatus === "GENERAL_RATE_SUPPORTED") return { label: "General rate supported", tone: "good", detail: "" };'), "Generally supported active profiles must not display category review warnings");
assert.ok(helpers.includes('if (categoryStatus === "MANUAL_VERIFIED") return { label: "Manual verified", tone: "neutral", detail: "" };'), "Manual/non-Colorado profiles must retain neutral behavior");
assert.ok(helpers.includes('profile?.provider === "LOOHAR_MANUAL_VERIFIED" ? "MANUAL_VERIFIED" : "GENERAL_RATE_SUPPORTED"'), "Missing category metadata must fall back safely without warnings");

assert.ok(helpers.includes("function taxComponentRows(profile = {})"), "Tax component display must normalize already-stored profile components");
assert.ok(helpers.includes("profile?.taxComponents"), "Tax component display must read persisted API profile taxComponents");
assert.ok(helpers.includes("Number.isSafeInteger(rateBps)"), "Tax component display must not render invalid or fabricated rates");
assert.ok(helpers.includes("Detailed jurisdiction breakdown is not available for this saved profile."), "Missing stored components must render a neutral empty state");
assert.ok(helpers.includes("function taxComponentBreakdownProfile(displayedProfile, history = [])"), "Tax settings must choose a safe component source");
assert.ok(helpers.includes("if (taxComponentRows(displayedProfile).length) return displayedProfile;"), "Current profile components must take precedence");
assert.ok(helpers.includes("sameTaxProfileVersion(displayedProfile, profile)"), "History fallback must be limited to the same profile version/material");
assert.ok(helpers.includes("profile.configurationVersion && candidate.configurationVersion"), "History fallback must use saved profile version identity");
assert.ok(helpers.includes("componentTotalBps === combinedRateBps"), "Stored component rates must be checked against the authoritative combined rate");
assert.ok(helpers.includes("Stored component rates require review against the saved combined rate."), "Component mismatches must surface as review copy without changing tax math");
assert.ok(helpers.includes("Tax breakdown") && helpers.includes("Combined"), "Tax component section must show a readable breakdown and stored combined rate");
assert.ok(taxSection.includes("const componentReferenceProfile = displayedTaxProfile || categoryReviewProfile || (location.history || [])[0] || null;"), "Component display must still work when only profile-history data is present");
assert.ok(taxSection.includes("const displayedComponentProfile = taxComponentBreakdownProfile(componentReferenceProfile, location.history);"), "Displayed profile must source components from current profile before same-version history");
assert.ok(taxSection.includes("{displayedComponentProfile ? <TaxComponentBreakdown profile={displayedComponentProfile} /> : null}"), "Location details must render stored component breakdown without requiring an active/review profile");
assert.ok(taxSection.includes("<TaxComponentBreakdown profile={profile} compact />"), "Each history profile must render only its own stored component breakdown");
assert.ok(taxSection.includes("displayedTaxProfile.taxRateBps"), "Combined rate must remain visible outside the component display");
assert.ok(taxSection.includes("readable(location.status || \"UNCONFIGURED\")"), "REFRESH_REQUIRED warning must remain visible while stored components are displayed");
assert.equal(/resolveTaxProfileForLocation|refreshTaxProfileForLocation|acknowledgeTaxProfile|api\(|api\.ttr\.services|COLORADO_TTR_API_KEY/.test(componentHelpers), false, "Rendering stored component breakdown must not call providers, mutations, or expose secrets");
assert.ok(componentHelpers.includes("break-words") && componentHelpers.includes("shrink-0"), "Component breakdown labels and rates must be mobile-safe");

console.log("tax-settings-ui-test passed (category review labels, separated location verification, activation block, history visibility, refresh distinction, active/manual safety).");
