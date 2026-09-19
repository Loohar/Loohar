import { PrismaClient } from "@prisma/client";
import { emitPrismaErrorLog } from "../utils/prismaLogFilter.js";

const globalForPrisma = globalThis;

function createPrismaClient() {
  if (process.env.NODE_ENV === "development") {
    return new PrismaClient({ log: ["query", "error", "warn"] });
  }
  const client = new PrismaClient({ log: [{ emit: "event", level: "error" }] });
  client.$on("error", (event) => emitPrismaErrorLog(event));
  return client;
}

export const prisma = globalForPrisma.looharPrisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.looharPrisma = prisma;
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
