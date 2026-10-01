const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const users = await prisma.usuario.findMany({ include: { usuarioRoles: { include: { rol: true } } } });
  console.log(JSON.stringify(users.map(u => ({ email: u.correo, roles: u.usuarioRoles.map(ur => ur.rol.nombre) })), null, 2));
}
run().finally(() => prisma.$disconnect());
