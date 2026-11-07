-- DropForeignKey
ALTER TABLE "usuario_roles" DROP CONSTRAINT "usuario_roles_barberia_id_fkey";

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_barberia_id_fkey" FOREIGN KEY ("barberia_id") REFERENCES "barberias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
