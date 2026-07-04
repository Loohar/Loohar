import { prisma } from "../config/prisma.js";

export function recordAudit({ actorUserId, restaurantId, action, entityType, entityId, metadata }) {
  return prisma.auditLog.create({
    data: {
      actorUserId,
      restaurantId,
      action,
      entityType,
      entityId,
      metadataJson: metadata || {}
    }
  });
}

