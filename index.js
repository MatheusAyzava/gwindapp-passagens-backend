require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticateUser, createUser, listUsers, updateUser, deleteUser, migratePasswords } = require('./auth');
const { criarCotacao, validarCotacao, formatarCotacao } = require('./cotacoesService');
const multer = require('multer');

// Configurar upload de arquivos
const uploadDir = path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadDir)) {
  require('fs').mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    // Aceitar PDFs e imagens
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos PDF e imagens são permitidos'));
    }
  }
});

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data.json');

// Configurar keep-alive para evitar muitas conexões TIME_WAIT
app.use((req, res, next) => {
  res.setHeader('Connection', 'keep-alive');
  next();
});

// Middleware
// Configurar CORS para aceitar requisições do Netlify e localhost
app.use(cors({
  origin: [
    'https://gwindapp-passagen.netlify.app',
    'https://passagen.netlify.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client/dist')));

// Inicializar dados se não existirem
async function initializeData() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    const initialData = {
      users: [
        { id: '1', name: 'João Silva', email: 'joao@empresa.com', role: 'colaborador', password: '123' },
        { id: '2', name: 'Maria Santos', email: 'maria@empresa.com', role: 'gerente', password: '123' },
        { id: '3', name: 'Pedro Costa', email: 'pedro@empresa.com', role: 'diretor', password: '123' },
        { id: '4', name: 'Ana Compras', email: 'ana@empresa.com', role: 'compras', password: '123' }
      ],
      solicitacoes: [],
      aprovacoes: []
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
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

// Rotas de autenticação
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    const result = await authenticateUser(email, password);
    
    if (result.success) {
      res.json({ success: true, user: result.user });
    } else {
      res.status(401).json({ success: false, message: result.message });
    }
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ success: false, message: 'Erro ao fazer login' });
  }
});

// Obter usuário atual
app.get('/api/user/:id', async (req, res) => {
  try {
    const data = await readData();
    const user = data.users.find(u => u.id === req.params.id);
    if (user) {
      const { password, passwordHash, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } else {
      res.status(404).json({ message: 'Usuário não encontrado' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Gerenciar usuários (requer autenticação de admin/diretor)
app.get('/api/users', async (req, res) => {
  try {
    const users = await listUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const result = await createUser(req.body);
    if (result.success) {
      res.status(201).json({ success: true, user: result.user });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const result = await updateUser(req.params.id, req.body);
    if (result.success) {
      res.json({ success: true, user: result.user });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const result = await deleteUser(req.params.id);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Rota para migrar senhas (executar uma vez)
app.post('/api/migrate-passwords', async (req, res) => {
  try {
    const result = await migratePasswords();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Criar solicitação
app.post('/api/solicitacoes', async (req, res) => {
  try {
    const data = await readData();
    const solicitacao = {
      id: uuidv4(),
      ...req.body,
      // Fluxo esperado no TravelFlow: entrar primeiro em pendente de aprovação
      // (o frontend filtra por pendente_gerente / pendente_diretor)
      status: 'pendente_gerente',
      cotacoes: [], // Array de cotações
      cotacaoSelecionada: null, // ID da cotação selecionada
      anexos: [], // Array de anexos (PDFs, bilhetes, etc)
      createdAt: new Date().toISOString(),
      historico: [{
        acao: 'Solicitação criada',
        data: new Date().toISOString()
      }]
    };
    
    data.solicitacoes.push(solicitacao);
    await writeData(data);
    res.json(solicitacao);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Listar solicitações
app.get('/api/solicitacoes', async (req, res) => {
  try {
    const data = await readData();
    res.json(data.solicitacoes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Obter solicitação por ID
app.get('/api/solicitacoes/:id', async (req, res) => {
  try {
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    if (solicitacao) {
      res.json(solicitacao);
    } else {
      res.status(404).json({ message: 'Solicitação não encontrada' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Aprovar/Rejeitar solicitação (Gerente)
app.post('/api/solicitacoes/:id/aprovar-gerente', async (req, res) => {
  try {
    const { aprovado, motivo } = req.body;
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    // Ajustar para novos status
    const statusEsperado = solicitacao.status === 'PENDENTE_GERENTE' || solicitacao.status === 'pendente_gerente';
    if (!statusEsperado) {
      return res.status(400).json({ message: 'Solicitação não está pendente de aprovação do gerente' });
    }
    
    solicitacao.status = aprovado ? 'PENDENTE_GERENTE_APROVADO' : 'REJEITADA';
    solicitacao.aprovacaoGerente = { aprovado, motivo, data: new Date().toISOString() };
    solicitacao.historico.push({
      acao: aprovado ? 'Aprovado pelo Gerente' : 'Rejeitado pelo Gerente',
      motivo,
      data: new Date().toISOString()
    });
    
    await writeData(data);
    res.json(solicitacao);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Aprovar/Rejeitar solicitação (Diretor)
app.post('/api/solicitacoes/:id/aprovar-diretor', async (req, res) => {
  try {
    const { aprovado, motivo } = req.body;
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    // Ajustar para novos status
    const statusEsperado = solicitacao.status === 'PENDENTE_DIRETOR' || solicitacao.status === 'pendente_diretor' || solicitacao.status === 'PENDENTE_GERENTE_APROVADO';
    if (!statusEsperado) {
      return res.status(400).json({ message: 'Solicitação não está pendente de aprovação do diretor' });
    }
    
    solicitacao.status = aprovado ? 'APROVADO_FINAL' : 'REJEITADA';
    solicitacao.aprovacaoDiretor = { aprovado, motivo, data: new Date().toISOString() };
    solicitacao.historico.push({
      acao: aprovado ? 'Aprovado pelo Diretor' : 'Rejeitado pelo Diretor',
      motivo,
      data: new Date().toISOString()
    });
    
    await writeData(data);
    res.json(solicitacao);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Processar solicitação (Compras)
app.post('/api/solicitacoes/:id/processar-compras', async (req, res) => {
  try {
    const { processado, observacoes } = req.body;
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    // Ajustar para novos status
    const statusEsperado = solicitacao.status === 'APROVADO_FINAL' || solicitacao.status === 'pendente_compras';
    if (!statusEsperado) {
      return res.status(400).json({ message: 'Solicitação não está aprovada para compra' });
    }
    
    solicitacao.status = 'EM_COMPRA';
    solicitacao.processamentoCompras = { 
      processado: true, 
      observacoes, 
      bilhete: observacoes,
      data: new Date().toISOString() 
    };
    solicitacao.historico.push({
      acao: 'Marcado como EM_COMPRA por Compras',
      motivo: observacoes,
      data: new Date().toISOString()
    });
    
    await writeData(data);
    res.json(solicitacao);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Finalizar compra (Compras) - após emissão
app.post('/api/solicitacoes/:id/finalizar-compra', async (req, res) => {
  try {
    const { localizador, companhia, valorFinal, observacoes } = req.body;
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    if (solicitacao.status !== 'EM_COMPRA') {
      return res.status(400).json({ message: 'Solicitação não está em processo de compra' });
    }
    
    solicitacao.status = 'COMPRADA';
    solicitacao.compraFinalizada = {
      localizador: localizador || '',
      companhia: companhia || '',
      valorFinal: parseFloat(valorFinal) || solicitacao.cotacoes?.find(c => c.id === solicitacao.cotacaoSelecionada)?.precoTotal || 0,
      observacoes: observacoes || '',
      data: new Date().toISOString()
    };
    
    solicitacao.historico.push({
      acao: 'Compra finalizada',
      motivo: `Localizador: ${localizador || 'N/A'}, Companhia: ${companhia || 'N/A'}`,
      data: new Date().toISOString()
    });
    
    // Integração com Smartsheet
    try {
      const { integrarSmartsheet } = require('./smartsheetService');
      await integrarSmartsheet(solicitacao);
    } catch (error) {
      console.error('[API] Erro ao integrar com Smartsheet:', error.message);
      // Não falhar a requisição se Smartsheet falhar
    }
    
    await writeData(data);
    res.json(solicitacao);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload de arquivos (PDF, bilhete, comprovante)
app.post('/api/solicitacoes/:id/anexos', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }
    
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    
    if (!solicitacao) {
      // Deletar arquivo se solicitação não existir
      require('fs').unlinkSync(req.file.path);
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    if (!solicitacao.anexos) {
      solicitacao.anexos = [];
    }
    
    const anexo = {
      id: `anexo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      nome: req.file.originalname,
      nomeArquivo: req.file.filename,
      caminho: req.file.path,
      tipo: req.file.mimetype,
      tamanho: req.file.size,
      uploadPor: req.body.uploadPor || 'sistema',
      data: new Date().toISOString()
    };
    
    solicitacao.anexos.push(anexo);
    
    solicitacao.historico.push({
      acao: 'Anexo adicionado',
      motivo: `Arquivo: ${req.file.originalname}`,
      data: new Date().toISOString()
    });
    
    await writeData(data);
    res.json({ anexo, solicitacao });
  } catch (error) {
    if (req.file) {
      require('fs').unlinkSync(req.file.path);
    }
    res.status(500).json({ message: error.message });
  }
});

// Listar anexos de uma solicitação
app.get('/api/solicitacoes/:id/anexos', async (req, res) => {
  try {
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    res.json(solicitacao.anexos || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Download de anexo
app.get('/api/solicitacoes/:id/anexos/:anexoId/download', async (req, res) => {
  try {
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    const anexo = solicitacao.anexos?.find(a => a.id === req.params.anexoId);
    if (!anexo) {
      return res.status(404).json({ message: 'Anexo não encontrado' });
    }
    
    res.download(anexo.caminho, anexo.nome);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Estatísticas
app.get('/api/estatisticas', async (req, res) => {
  try {
    const data = await readData();
    const solicitacoes = data.solicitacoes;
    
    const stats = {
      total: solicitacoes.length,
      pendenteCotacao: solicitacoes.filter(s => s.status === 'PENDENTE_COTACAO').length,
      aguardandoEscolha: solicitacoes.filter(s => s.status === 'AGUARDANDO_ESCOLHA').length,
      aguardandoAprovacao: solicitacoes.filter(s => s.status === 'AGUARDANDO_APROVACAO').length,
      pendenteGestor: solicitacoes.filter(s => s.status === 'PENDENTE_GESTOR').length,
      pendenteGerente: solicitacoes.filter(s => s.status === 'PENDENTE_GERENTE' || s.status === 'pendente_gerente').length,
      pendenteDiretor: solicitacoes.filter(s => s.status === 'PENDENTE_DIRETOR' || s.status === 'pendente_diretor').length,
      emCompra: solicitacoes.filter(s => s.status === 'EM_COMPRA').length,
      compradas: solicitacoes.filter(s => s.status === 'COMPRADA').length,
      rejeitadas: solicitacoes.filter(s => s.status === 'REJEITADA' || s.status === 'rejeitada').length,
      ajusteSolicitado: solicitacoes.filter(s => s.status === 'AJUSTE_SOLICITADO').length
    };
    
    // Calcular valor total estimado do mês
    const mesAtual = new Date().getMonth();
    const anoAtual = new Date().getFullYear();
    const solicitacoesMes = solicitacoes.filter(s => {
      const dataSolicitacao = new Date(s.createdAt);
      return dataSolicitacao.getMonth() === mesAtual && dataSolicitacao.getFullYear() === anoAtual;
    });
    
    const valorTotalEstimado = solicitacoesMes.reduce((total, s) => {
      if (s.cotacaoSelecionada && s.cotacoes) {
        const cotacao = s.cotacoes.find(c => c.id === s.cotacaoSelecionada);
        return total + (cotacao?.precoTotal || 0);
      }
      return total;
    }, 0);
    
    stats.valorTotalEstimadoMes = valorTotalEstimado;
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================================
// ENDPOINTS DE COTAÇÕES
// ============================================

// Adicionar cotação a uma solicitação (Compras)
app.post('/api/solicitacoes/:id/cotacoes', async (req, res) => {
  try {
    const { id } = req.params;
    const dadosCotacao = req.body;
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    // Criar cotação
    const cotacao = criarCotacao({
      ...dadosCotacao,
      criadoPor: req.body.criadoPor || 'compras',
      criadoEm: new Date().toISOString()
    });
    
    // Validar cotação
    const validacao = validarCotacao(cotacao);
    if (!validacao.valida) {
      return res.status(400).json({ message: 'Cotação inválida', erros: validacao.erros });
    }
    
    // Inicializar array de cotações se não existir
    if (!solicitacao.cotacoes) {
      solicitacao.cotacoes = [];
    }
    
    // Adicionar cotação
    solicitacao.cotacoes.push(cotacao);
    
    // Atualizar status se for a primeira cotação
    if (solicitacao.status === 'PENDENTE_COTACAO' && solicitacao.cotacoes.length === 1) {
      solicitacao.status = 'AGUARDANDO_ESCOLHA';
      solicitacao.historico.push({
        acao: 'Cotações adicionadas por Compras',
        data: new Date().toISOString()
      });
    }
    
    await writeData(data);
    res.json({ cotacao: formatarCotacao(cotacao), solicitacao });
  } catch (error) {
    console.error('[API] Erro ao adicionar cotação:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// Listar cotações de uma solicitação
app.get('/api/solicitacoes/:id/cotacoes', async (req, res) => {
  try {
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === req.params.id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    const cotacoes = (solicitacao.cotacoes || []).map(formatarCotacao);
    res.json(cotacoes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Selecionar cotação (Solicitante)
app.post('/api/solicitacoes/:id/cotacoes/:cotacaoId/selecionar', async (req, res) => {
  try {
    const { id, cotacaoId } = req.params;
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    if (!solicitacao.cotacoes || solicitacao.cotacoes.length === 0) {
      return res.status(400).json({ message: 'Nenhuma cotação disponível' });
    }
    
    const cotacao = solicitacao.cotacoes.find(c => c.id === cotacaoId);
    if (!cotacao) {
      return res.status(404).json({ message: 'Cotação não encontrada' });
    }
    
    // Verificar se cotação está válida
    const { cotacaoValida: verificarValidade } = require('./cotacoesService');
    if (!verificarValidade(cotacao)) {
      return res.status(400).json({ message: 'Cotação expirada. Solicite nova cotação.' });
    }
    
    // Desselecionar outras cotações
    solicitacao.cotacoes.forEach(c => c.selecionada = false);
    
    // Selecionar cotação
    cotacao.selecionada = true;
    solicitacao.cotacaoSelecionada = cotacaoId;
    solicitacao.status = 'AGUARDANDO_APROVACAO';
    
    // Calcular valor para roteamento de aprovação
    const valorTotal = cotacao.precoTotal;
    let proximoStatus = 'PENDENTE_GESTOR';
    
    // Roteamento por valor (ajustar valores conforme necessário)
    if (valorTotal > 5000) {
      proximoStatus = 'PENDENTE_DIRETOR'; // Acima de R$ 5000 → Diretor
    } else if (valorTotal > 2000) {
      proximoStatus = 'PENDENTE_GERENTE'; // Acima de R$ 2000 → Gerente
    }
    // Até R$ 2000 → Gestor (padrão)
    
    solicitacao.status = proximoStatus;
    
    solicitacao.historico.push({
      acao: 'Cotação selecionada pelo solicitante',
      cotacao: cotacao.companhia,
      valor: cotacao.precoTotal,
      data: new Date().toISOString()
    });
    
    await writeData(data);
    res.json(solicitacao);
  } catch (error) {
    console.error('[API] Erro ao selecionar cotação:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// Remover cotação (Compras)
app.delete('/api/solicitacoes/:id/cotacoes/:cotacaoId', async (req, res) => {
  try {
    const { id, cotacaoId } = req.params;
    const data = await readData();
    const solicitacao = data.solicitacoes.find(s => s.id === id);
    
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada' });
    }
    
    if (!solicitacao.cotacoes) {
      return res.status(400).json({ message: 'Nenhuma cotação disponível' });
    }
    
    const index = solicitacao.cotacoes.findIndex(c => c.id === cotacaoId);
    if (index === -1) {
      return res.status(404).json({ message: 'Cotação não encontrada' });
    }
    
    solicitacao.cotacoes.splice(index, 1);
    
    // Se não houver mais cotações, voltar para PENDENTE_COTACAO
    if (solicitacao.cotacoes.length === 0) {
      solicitacao.status = 'PENDENTE_COTACAO';
    }
    
    await writeData(data);
    res.json(solicitacao);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Inicializar e iniciar servidor
initializeData().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`📡 API disponível em http://localhost:${PORT}`);
  });

  // Configurações para melhor gerenciamento de conexões
  server.keepAliveTimeout = 61 * 1000; // 61 segundos
  server.headersTimeout = 65 * 1000; // 65 segundos
  
  // Tratamento de erros do servidor
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Erro: Porta ${PORT} já está em uso!`);
      console.error('💡 Solução: Pare todos os processos Node com: Get-Process node | Stop-Process -Force');
      console.error('   Ou aguarde alguns minutos para as conexões TIME_WAIT expirarem.');
    } else {
      console.error('❌ Erro no servidor:', error);
    }
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('🛑 Encerrando servidor...');
    server.close(() => {
      console.log('✅ Servidor encerrado.');
      process.exit(0);
    });
  });
});

