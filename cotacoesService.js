// Serviço de Cotações Manuais
// Sistema de cotações sem APIs externas

// Estrutura de uma cotação
function criarCotacao(dados) {
  return {
    id: dados.id || `cotacao-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    companhia: dados.companhia || '',
    agencia: dados.agencia || '',
    horarioIda: dados.horarioIda || '',
    horarioVolta: dados.horarioVolta || null,
    escalas: dados.escalas || 0,
    duracao: dados.duracao || '',
    bagagem: dados.bagagem || {
      inclui: false,
      quantidade: 0,
      peso: 0
    },
    taxaRemarcacao: dados.taxaRemarcacao || '',
    politicaRemarcacao: dados.politicaRemarcacao || '',
    precoTotal: parseFloat(dados.precoTotal) || 0,
    moeda: dados.moeda || 'BRL',
    validade: dados.validade || null, // Data de expiração da cotação
    linkFonte: dados.linkFonte || '',
    observacoes: dados.observacoes || '',
    criadoPor: dados.criadoPor || '',
    criadoEm: dados.criadoEm || new Date().toISOString(),
    selecionada: false
  };
}

// Validar cotação
function validarCotacao(cotacao) {
  const erros = [];
  
  if (!cotacao.companhia || cotacao.companhia.trim() === '') {
    erros.push('Companhia é obrigatória');
  }
  
  if (!cotacao.horarioIda || cotacao.horarioIda.trim() === '') {
    erros.push('Horário de ida é obrigatório');
  }
  
  if (!cotacao.precoTotal || cotacao.precoTotal <= 0) {
    erros.push('Preço total deve ser maior que zero');
  }
  
  return {
    valida: erros.length === 0,
    erros
  };
}

// Verificar se cotação está válida (não expirou)
function cotacaoValida(cotacao) {
  if (!cotacao.validade) {
    return true; // Sem validade = sempre válida
  }
  
  const dataValidade = new Date(cotacao.validade);
  const agora = new Date();
  
  return dataValidade > agora;
}

// Formatar cotação para exibição
function formatarCotacao(cotacao) {
  return {
    ...cotacao,
    precoFormatado: new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: cotacao.moeda || 'BRL'
    }).format(cotacao.precoTotal),
    validadeFormatada: cotacao.validade 
      ? new Date(cotacao.validade).toLocaleString('pt-BR')
      : 'Sem validade',
    estaValida: cotacaoValida(cotacao),
    bagagemTexto: cotacao.bagagem?.inclui 
      ? `${cotacao.bagagem.quantidade} bagagem(ns) de ${cotacao.bagagem.peso}kg`
      : 'Bagagem não incluída'
  };
}

module.exports = {
  criarCotacao,
  validarCotacao,
  cotacaoValida,
  formatarCotacao
};

