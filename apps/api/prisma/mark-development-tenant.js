import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function exitWithError(message) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  const tenantId = process.env.DEVELOPMENT_TENANT_ID?.trim();
  if (!tenantId) {
    exitWithError("DEVELOPMENT_TENANT_ID is required. Refusing to mark a tenant by name, slug, or any fuzzy selector.");
    return;
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      slug: true,
      name: true,
      businessName: true,
      tenantClassification: true
    }
  });

  if (!restaurant) {
    exitWithError(`No restaurant tenant found for DEVELOPMENT_TENANT_ID=${tenantId}. No records were changed.`);
    return;
  }

  console.log("Development tenant classification target:");
  console.log(`- id: ${restaurant.id}`);
  console.log(`- slug: ${restaurant.slug}`);
  console.log(`- name: ${restaurant.businessName || restaurant.name}`);
  console.log(`- current classification: ${restaurant.tenantClassification}`);

  if (restaurant.tenantClassification === "INTERNAL_DEVELOPMENT") {
    console.log("Tenant is already INTERNAL_DEVELOPMENT. No billing, subscription, payment, or payout records were changed.");
    return;
  }

  const updated = await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: { tenantClassification: "INTERNAL_DEVELOPMENT" },
    select: { id: true, tenantClassification: true }
  });

  await prisma.auditLog.create({
    data: {
      restaurantId: restaurant.id,
      action: "development.tenant_classification.updated",
      entityType: "Restaurant",
      entityId: restaurant.id,
      metadataJson: {
        previousClassification: restaurant.tenantClassification,
        nextClassification: updated.tenantClassification,
        source: "tenant:mark-development",
        billingChanged: false,
        subscriptionChanged: false,
        paymentChanged: false
      }
    }
  });

  console.log(`Tenant ${updated.id} marked as ${updated.tenantClassification}.`);
  console.log("No Stripe, billing, subscription, order-payment, payout, or merchant records were changed.");
}

main()
  .catch((error) => {
    console.error("Failed to mark development tenant.", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
