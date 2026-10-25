-- Make cedula nullable if not already
ALTER TABLE "usuarios" ALTER COLUMN "cedula" DROP NOT NULL;
