// Serviço de Integração com Smartsheet
// Quando uma solicitação é aprovada e comprada, envia para o Smartsheet

const axios = require('axios');

// Configuração do Smartsheet
const SMARTSHEET_API_KEY = process.env.SMARTSHEET_API_KEY || '';
const SMARTSHEET_SHEET_ID = process.env.SMARTSHEET_SHEET_ID || '';
const SMARTSHEET_ENABLED = SMARTSHEET_API_KEY && SMARTSHEET_SHEET_ID;

// Integrar solicitação com Smartsheet
async function integrarSmartsheet(solicitacao) {
  if (!SMARTSHEET_ENABLED) {
    console.log('[Smartsheet] Integração desabilitada - configure SMARTSHEET_API_KEY e SMARTSHEET_SHEET_ID');
    return { success: false, message: 'Smartsheet não configurado' };
  }

  try {
    // Preparar dados para o Smartsheet
    const rowData = {
      toTop: true,
      cells: [
        { columnId: obterColumnId('Solicitante'), value: solicitacao.solicitanteNome || solicitacao.solicitanteId },
        { columnId: obterColumnId('Origem'), value: solicitacao.origem },
        { columnId: obterColumnId('Destino'), value: solicitacao.destino },
        { columnId: obterColumnId('Data Ida'), value: solicitacao.dataIda },
        { columnId: obterColumnId('Data Volta'), value: solicitacao.dataVolta || '' },
        { columnId: obterColumnId('Companhia'), value: solicitacao.compraFinalizada?.companhia || '' },
        { columnId: obterColumnId('Localizador'), value: solicitacao.compraFinalizada?.localizador || '' },
        { columnId: obterColumnId('Valor Final'), value: solicitacao.compraFinalizada?.valorFinal || 0 },
        { columnId: obterColumnId('Status'), value: solicitacao.status },
        { columnId: obterColumnId('Data Compra'), value: solicitacao.compraFinalizada?.data || new Date().toISOString() }
      ]
    };

    // Adicionar linha no Smartsheet
    const response = await axios.post(
      `https://api.smartsheet.com/2.0/sheets/${SMARTSHEET_SHEET_ID}/rows`,
      rowData,
      {
        headers: {
          'Authorization': `Bearer ${SMARTSHEET_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[Smartsheet] Solicitação integrada com sucesso:', response.data.result?.id);
    return { success: true, rowId: response.data.result?.id };
  } catch (error) {
    console.error('[Smartsheet] Erro ao integrar:', error.response?.data || error.message);
    return { success: false, message: error.message };
  }
}

// Obter ID da coluna (simplificado - em produção, buscar dinamicamente)
function obterColumnId(nomeColuna) {
  // Mapeamento básico - em produção, buscar via API do Smartsheet
  const columnMap = {
    'Solicitante': 1,
    'Origem': 2,
    'Destino': 3,
    'Data Ida': 4,
    'Data Volta': 5,
    'Companhia': 6,
    'Localizador': 7,
    'Valor Final': 8,
    'Status': 9,
    'Data Compra': 10
  };
  
  return columnMap[nomeColuna] || null;
}

// Buscar colunas do Smartsheet (para configurar dinamicamente)
async function buscarColunas() {
  if (!SMARTSHEET_ENABLED) {
    return null;
  }

  try {
    const response = await axios.get(
      `https://api.smartsheet.com/2.0/sheets/${SMARTSHEET_SHEET_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${SMARTSHEET_API_KEY}`
        }
      }
    );

    return response.data.columns || [];
  } catch (error) {
    console.error('[Smartsheet] Erro ao buscar colunas:', error.message);
    return null;
  }
}

module.exports = {
  integrarSmartsheet,
  buscarColunas,
  SMARTSHEET_ENABLED
};



