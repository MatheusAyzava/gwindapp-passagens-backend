const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, 'data.json');

// Hash de senha
async function hashPassword(password) {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

// Verificar senha
async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

// Ler dados
async function readData() {
  const data = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(data);
}

// Escrever dados
async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// Autenticar usuário
async function authenticateUser(email, password) {
  try {
    const data = await readData();
    const user = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      return { success: false, message: 'Email ou senha incorretos' };
    }

    // Se a senha não está hasheada (migração), verificar diretamente
    if (!user.passwordHash) {
      if (user.password === password) {
        // Migrar senha para hash
        user.passwordHash = await hashPassword(password);
        delete user.password;
        await writeData(data);
        return { 
          success: true, 
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
          }
        };
      }
      return { success: false, message: 'Email ou senha incorretos' };
    }

    // Verificar senha hasheada
    const isValid = await comparePassword(password, user.passwordHash);
    
    if (isValid) {
      return { 
        success: true, 
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      };
    }

    return { success: false, message: 'Email ou senha incorretos' };
  } catch (error) {
    console.error('Erro na autenticação:', error);
    return { success: false, message: 'Erro ao autenticar usuário' };
  }
}

// Criar novo usuário
async function createUser(userData) {
  try {
    const { name, email, password, role } = userData;
    
    if (!name || !email || !password || !role) {
      return { success: false, message: 'Todos os campos são obrigatórios' };
    }

    const data = await readData();
    
    // Verificar se email já existe
    const existingUser = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return { success: false, message: 'Email já cadastrado' };
    }

    // Validar role
    const validRoles = ['colaborador', 'gerente', 'diretor', 'compras'];
    if (!validRoles.includes(role)) {
      return { success: false, message: 'Role inválido' };
    }

    // Criar usuário
    const newUser = {
      id: uuidv4(),
      name,
      email: email.toLowerCase(),
      role,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString()
    };

    data.users.push(newUser);
    await writeData(data);

    return { 
      success: true, 
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    };
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    return { success: false, message: 'Erro ao criar usuário' };
  }
}

// Listar usuários (sem senhas)
async function listUsers() {
  try {
    const data = await readData();
    return data.users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    }));
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    return [];
  }
}

// Atualizar usuário
async function updateUser(userId, updates) {
  try {
    const data = await readData();
    const userIndex = data.users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return { success: false, message: 'Usuário não encontrado' };
    }

    const user = data.users[userIndex];

    // Atualizar campos permitidos
    if (updates.name) user.name = updates.name;
    if (updates.email) {
      // Verificar se email já existe em outro usuário
      const emailExists = data.users.some(u => 
        u.id !== userId && u.email.toLowerCase() === updates.email.toLowerCase()
      );
      if (emailExists) {
        return { success: false, message: 'Email já cadastrado' };
      }
      user.email = updates.email.toLowerCase();
    }
    if (updates.role) {
      const validRoles = ['colaborador', 'gerente', 'diretor', 'compras'];
      if (!validRoles.includes(updates.role)) {
        return { success: false, message: 'Role inválido' };
      }
      user.role = updates.role;
    }
    if (updates.password) {
      user.passwordHash = await hashPassword(updates.password);
      // Remover senha antiga se existir
      if (user.password) delete user.password;
    }

    user.updatedAt = new Date().toISOString();
    data.users[userIndex] = user;
    await writeData(data);

    return { 
      success: true, 
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    };
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    return { success: false, message: 'Erro ao atualizar usuário' };
  }
}

// Deletar usuário
async function deleteUser(userId) {
  try {
    const data = await readData();
    const userIndex = data.users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return { success: false, message: 'Usuário não encontrado' };
    }

    data.users.splice(userIndex, 1);
    await writeData(data);

    return { success: true };
  } catch (error) {
    console.error('Erro ao deletar usuário:', error);
    return { success: false, message: 'Erro ao deletar usuário' };
  }
}

// Migrar senhas antigas para hash (script de migração)
async function migratePasswords() {
  try {
    const data = await readData();
    let migrated = 0;

    for (const user of data.users) {
      if (user.password && !user.passwordHash) {
        user.passwordHash = await hashPassword(user.password);
        delete user.password;
        migrated++;
      }
    }

    if (migrated > 0) {
      await writeData(data);
      console.log(`✅ ${migrated} senha(s) migrada(s) para hash`);
    } else {
      console.log('✅ Todas as senhas já estão hasheadas');
    }

    return { success: true, migrated };
  } catch (error) {
    console.error('Erro na migração:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  authenticateUser,
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  migratePasswords,
  hashPassword,
  comparePassword
};




