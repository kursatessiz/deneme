-- AlterTable
ALTER TABLE "cancellation_policies" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "resource_types" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;
