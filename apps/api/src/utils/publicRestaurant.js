// Restaurant fields that anonymous storefront and website visitors may see. Billing, trial, lifecycle,
// onboarding, classification and raw settings stay internal. Relations are included only when the
// caller loaded them.
const PUBLIC_RESTAURANT_FIELDS = [
  "id",
  "name",
  "businessName",
  "businessType",
  "slug",
  "status",
  "description",
  "brandingJson",
  "logoUrl",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "timezone",
  "latitude",
  "longitude",
  "deliveryRadiusMiles",
  "deliveryEnabled",
  "pickupEnabled",
  "deliveryFeeCents",
  "storeHoursJson",
  "enabledModules",
  "loyaltySettingsJson",
  "websitePublishedAt",
  "categories",
  "loyaltyRewards",
  "websiteSettings",
  "domains"
];

export function publicRestaurantProfile(restaurant) {
  if (!restaurant) return restaurant;
  return Object.fromEntries(PUBLIC_RESTAURANT_FIELDS.filter((field) => field in restaurant).map((field) => [field, restaurant[field]]));
}
