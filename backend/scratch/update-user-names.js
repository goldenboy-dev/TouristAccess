const prisma = require('../src/utils/prisma');

async function updateExistingUsers() {
  console.log('=== Actualizando nombres de usuarios existentes ===');
  
  try {
    const users = await prisma.user.findMany({
      where: {
        name: ''
      }
    });

    console.log(`Encontrados ${users.length} usuarios sin nombre.`);

    for (const user of users) {
      // Derive name from email (capitalize first letter of the part before @)
      const emailPrefix = user.email.split('@')[0];
      const derivedName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
      
      await prisma.user.update({
        where: { id: user.id },
        data: { name: derivedName }
      });
      
      console.log(`Actualizado ID ${user.id}: ${user.email} -> ${derivedName}`);
    }

    console.log('\n✅ Actualización completada.');
  } catch (error) {
    console.error('Error durante la actualización:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateExistingUsers();
