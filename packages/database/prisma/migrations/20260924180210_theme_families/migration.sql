-- CreateEnum
CREATE TYPE "ColorSchemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- AlterTable
ALTER TABLE "studios" ADD COLUMN     "theme_family" VARCHAR(20) NOT NULL DEFAULT 'atolye',
ALTER COLUMN "theme_primary" SET DEFAULT '#2F6F5E',
ALTER COLUMN "gradient_preset_key" SET DEFAULT 'atolye-orman';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "color_scheme" "ColorSchemePreference" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "theme_family" VARCHAR(20);

-- Hand-written: move the pre-family gradient keys to their Atolye equivalents.
UPDATE "studios" SET "gradient_preset_key" = CASE "gradient_preset_key"
  WHEN 'clay' THEN 'atolye-kil'
  WHEN 'sage' THEN 'atolye-orman'
  WHEN 'ocean' THEN 'atolye-lacivert'
  WHEN 'sand' THEN 'atolye-toprak'
  WHEN 'graphite' THEN 'atolye-duman'
  ELSE "gradient_preset_key"
END
WHERE "gradient_preset_key" IN ('clay', 'sage', 'ocean', 'sand', 'graphite');
