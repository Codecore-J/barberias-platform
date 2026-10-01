const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`
    SELECT u.correo, r.nombre, ur.barberia_id 
    FROM "usuario_roles" ur 
    JOIN "usuarios" u ON u.id = ur.usuario_id 
    JOIN "roles" r ON r.id = ur.rol_id 
    WHERE r.nombre IN ('ADMINISTRADOR', 'ADMIN_BARBERIA', 'SUPER_ADMIN');
  `;
  console.log(result);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
