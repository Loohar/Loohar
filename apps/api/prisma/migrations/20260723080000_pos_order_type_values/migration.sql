-- Commit POS order enum values before migrations use them as defaults.
ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'DINE_IN';
ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'WALK_IN';
