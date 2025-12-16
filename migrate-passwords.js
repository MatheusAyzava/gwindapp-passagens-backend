// Script para migrar senhas antigas para hash
// Execute: node server/migrate-passwords.js

const { migratePasswords } = require('./auth');

async function main() {
  console.log('🔄 Iniciando migração de senhas...');
  const result = await migratePasswords();
  
  if (result.success) {
    console.log(`✅ Migração concluída! ${result.migrated} senha(s) migrada(s).`);
  } else {
    console.error('❌ Erro na migração:', result.error);
    process.exit(1);
  }
}

main();




