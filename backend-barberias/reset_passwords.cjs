const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();
async function run() {
  const hash = await bcrypt.hash('Password123!', 10);
  await prisma.usuario.updateMany({
    where: { correo: { in: ['admin@demo.com', 'barbero@demo.com', 'cliente@demo.com'] } },
    data: { passwordHash: hash }
  });
  console.log('Passwords updated to Password123!');
}
run().finally(() => prisma.$disconnect());
