// Serviço de busca de voos
// Suporta Amadeus API, Multi-API e modo mock para desenvolvimento

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const { searchFlightsMultiAPI, API_CONFIG } = require('./multiAPI');

// Configuração - Configure suas credenciais da Amadeus aqui
const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY || '';
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET || '';
const USE_MOCK_FLIGHTS = process.env.USE_MOCK_FLIGHTS === 'true';
// TravelLink está sempre habilitada, então só usa mock se explicitamente configurado
const USE_MOCK_DATA = USE_MOCK_FLIGHTS === 'true';

// Log de configuração (sem mostrar o secret completo)
console.log('[FlightsService] Configuração:');
console.log(`[FlightsService] TravelLink/Wooba: HABILITADA (API Principal)`);
console.log(`[FlightsService] Amadeus API Key: ${AMADEUS_API_KEY ? AMADEUS_API_KEY.substring(0, 10) + '...' : 'NÃO CONFIGURADA'}`);
console.log(`[FlightsService] Amadeus API Secret: ${AMADEUS_API_SECRET ? '***' + AMADEUS_API_SECRET.substring(AMADEUS_API_SECRET.length - 3) : 'NÃO CONFIGURADA'}`);
console.log(`[FlightsService] Usando dados mock: ${USE_MOCK_DATA}`);

// Cache de token Amadeus
let amadeusToken = null;
let tokenExpiry = null;

// Obter token de autenticação Amadeus
async function getAmadeusToken() {
  if (amadeusToken && tokenExpiry && Date.now() < tokenExpiry) {
    return amadeusToken;
  }

  try {
    console.log('[Amadeus] Solicitando token de autenticação...');
    
    if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
      throw new Error('Credenciais da API Amadeus não configuradas. Verifique AMADEUS_API_KEY e AMADEUS_API_SECRET no arquivo .env');
    }

    // Usar API de produção se tiver credenciais de produção, senão usar test
    const apiBaseUrl = process.env.AMADEUS_ENV === 'production' 
      ? 'https://api.amadeus.com'
      : 'https://test.api.amadeus.com';
    
    console.log(`[Amadeus] Usando ambiente: ${apiBaseUrl.includes('test') ? 'TEST' : 'PRODUCTION'}`);
    
    const response = await axios.post(
      `${apiBaseUrl}/v1/security/oauth2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: AMADEUS_API_KEY,
        client_secret: AMADEUS_API_SECRET
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000 // 10 segundos de timeout
      }
    );

    amadeusToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // -1 minuto de margem
    console.log('[Amadeus] Token obtido com sucesso');
    return amadeusToken;
  } catch (error) {
    console.error('[Amadeus] Erro ao obter token:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      throw new Error('Credenciais inválidas. Verifique AMADEUS_API_KEY e AMADEUS_API_SECRET no arquivo .env');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Não foi possível conectar à API do Amadeus. Verifique sua conexão com a internet.');
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      throw new Error('Tempo de espera esgotado ao conectar com a API do Amadeus.');
    }
    
    throw new Error(`Erro ao autenticar com Amadeus API: ${error.message}`);
  }
}

// Converter código de cidade para código IATA (simplificado)
function getCityCode(city) {
  // Se já é um código IATA (3 letras maiúsculas), retorna direto
  if (/^[A-Z]{3}$/.test(city.trim().toUpperCase())) {
    return city.trim().toUpperCase();
  }

  const cityMap = {
    'são paulo': 'SAO',
    'sao paulo': 'SAO',
    'rio de janeiro': 'RIO',
    'rio': 'RIO',
    'brasília': 'BSB',
    'brasilia': 'BSB',
    'salvador': 'SSA',
    'fortaleza': 'FOR',
    'belo horizonte': 'CNF',
    'manaus': 'MAO',
    'curitiba': 'CWB',
    'porto alegre': 'POA',
    'recife': 'REC',
    'belém': 'BEL',
    'belem': 'BEL',
    'goiânia': 'GYN',
    'goiania': 'GYN',
    'vitória': 'VIX',
    'vitoria': 'VIX',
    'florianópolis': 'FLN',
    'florianopolis': 'FLN',
    'campinas': 'VCP',
    'guarulhos': 'GRU',
    'congonhas': 'CGH',
    'santos dumont': 'SDU',
    'roma': 'FCO',
    'rome': 'FCO',
    'paris': 'CDG',
    'londres': 'LHR',
    'london': 'LHR',
    'nova york': 'JFK',
    'new york': 'JFK',
    'miami': 'MIA',
    'orlando': 'MCO',
    'lisboa': 'LIS',
    'lisbon': 'LIS',
    'madrid': 'MAD',
    'barcelona': 'BCN',
    'amsterdam': 'AMS',
    'frankfurt': 'FRA',
    'munique': 'MUC',
    'munich': 'MUC',
    'zurich': 'ZRH',
    'viena': 'VIE',
    'vienna': 'VIE',
    'atenas': 'ATH',
    'athens': 'ATH',
    'dubai': 'DXB',
    'doha': 'DOH',
    'singapura': 'SIN',
    'singapore': 'SIN',
    'tokyo': 'NRT',
    'hong kong': 'HKG',
    'sydney': 'SYD',
    'melbourne': 'MEL',
    'buenos aires': 'EZE',
    'santiago': 'SCL',
    'lima': 'LIM',
    'bogotá': 'BOG',
    'bogota': 'BOG',
    'cidade do méxico': 'MEX',
    'mexico city': 'MEX'
  };

  const normalized = city.toLowerCase().trim();
  const code = cityMap[normalized];
  
  if (code) {
    return code;
  }
  
  // Se não encontrou no mapa, tenta extrair código IATA (3 letras)
  const match = city.match(/\b([A-Z]{3})\b/i);
  if (match) {
    return match[1].toUpperCase();
  }
  
  // Último recurso: pega as primeiras 3 letras em maiúsculas
  return city.substring(0, 3).toUpperCase();
}

// Buscar voos usando Amadeus API
async function searchFlightsAmadeus(origem, destino, dataIda, dataVolta) {
  try {
    const token = await getAmadeusToken();
    const origemCode = getCityCode(origem);
    const destinoCode = getCityCode(destino);

    // Formatar datas para YYYY-MM-DD
    const dataIdaFormatted = new Date(dataIda).toISOString().split('T')[0];
    const dataVoltaFormatted = dataVolta ? new Date(dataVolta).toISOString().split('T')[0] : null;

    const params = {
      originLocationCode: origemCode,
      destinationLocationCode: destinoCode,
      departureDate: dataIdaFormatted,
      adults: 1,
      max: 15
    };

    if (dataVoltaFormatted) {
      params.returnDate = dataVoltaFormatted;
    }

    // Usar API de produção se tiver credenciais de produção, senão usar test
    const apiBaseUrl = process.env.AMADEUS_ENV === 'production' 
      ? 'https://api.amadeus.com'
      : 'https://test.api.amadeus.com';
    
    console.log(`[Amadeus] Buscando voos REAIS: ${origemCode} → ${destinoCode} em ${dataIdaFormatted}`);
    console.log(`[Amadeus] Ambiente: ${apiBaseUrl.includes('test') ? 'TEST' : 'PRODUCTION'}`);
    console.log(`[Amadeus] Parâmetros:`, JSON.stringify(params, null, 2));

    const response = await axios.get(
      `${apiBaseUrl}/v2/shopping/flight-offers`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        params,
        timeout: 15000 // 15 segundos de timeout
      }
    );
    
    console.log(`[Amadeus] Resposta recebida: ${response.data?.data?.length || 0} voo(s) encontrado(s)`);

    const resultados = formatAmadeusResults(response.data);
    console.log(`Encontrados ${resultados.length} voos`);
    return resultados;
  } catch (error) {
    console.error('[Amadeus] Erro ao buscar voos:', error.response?.data || error.message);
    
    // Mensagens de erro mais específicas
    if (error.response?.status === 401) {
      throw new Error('Token de autenticação inválido ou expirado. Tente novamente.');
    } else if (error.response?.status === 400) {
      const errorDetail = error.response?.data?.errors?.[0]?.detail || 'Parâmetros inválidos';
      throw new Error(`Parâmetros inválidos: ${errorDetail}. Verifique origem, destino e datas.`);
    } else if (error.response?.status === 429) {
      throw new Error('Limite de requisições excedido. Tente novamente mais tarde.');
    } else if (error.response?.status === 404) {
      throw new Error('Nenhum voo encontrado para os critérios informados.');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Não foi possível conectar à API do Amadeus. Verifique sua conexão.');
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      throw new Error('Tempo de espera esgotado ao buscar voos.');
    }
    
    const errorDetail = error.response?.data?.errors?.[0]?.detail || error.message;
    throw new Error(`Erro ao buscar voos: ${errorDetail}`);
  }
}

// Formatar resultados da Amadeus
function formatAmadeusResults(data) {
  if (!data.data || data.data.length === 0) {
    return [];
  }

  return data.data.map((offer, index) => {
    const itineraries = offer.itineraries || [];
    const ida = itineraries[0] || {};
    const volta = itineraries[1] || null;

    // Obter código da companhia aérea (pode usar o primeiro segmento)
    const primeiraCompanhia = ida.segments?.[0]?.carrierCode || 'N/A';
    
    // Mapear códigos de companhia para nomes conhecidos
    const companhiaMap = {
      'LA': 'LATAM',
      'G3': 'GOL',
      'AD': 'Azul',
      'JJ': 'LATAM',
      'TP': 'TAP',
      'AF': 'Air France',
      'KL': 'KLM',
      'LH': 'Lufthansa',
      'EK': 'Emirates',
      'QR': 'Qatar Airways',
      'AA': 'American Airlines',
      'DL': 'Delta',
      'UA': 'United'
    };

    return {
      id: offer.id || `flight-${index}`,
      preco: offer.price?.total || '0',
      moeda: offer.price?.currency || 'BRL',
      companhia: companhiaMap[primeiraCompanhia] || primeiraCompanhia,
      origem: ida.segments?.[0]?.departure?.iataCode || '',
      destino: volta 
        ? volta.segments?.[volta.segments.length - 1]?.arrival?.iataCode 
        : ida.segments?.[ida.segments.length - 1]?.arrival?.iataCode || '',
      dataIda: ida.segments?.[0]?.departure?.at || '',
      dataVolta: volta ? volta.segments?.[0]?.departure?.at : null,
      duracaoIda: calculateDuration(ida),
      duracaoVolta: volta ? calculateDuration(volta) : null,
      escalasIda: (ida.segments?.length || 1) - 1,
      escalasVolta: volta ? (volta.segments?.length || 1) - 1 : null,
      detalhes: {
        ida: ida.segments?.map(seg => ({
          origem: seg.departure?.iataCode,
          destino: seg.arrival?.iataCode,
          partida: seg.departure?.at,
          chegada: seg.arrival?.at,
          duracao: seg.duration,
          companhia: companhiaMap[seg.carrierCode] || seg.carrierCode,
          numeroVoo: seg.number
        })) || [],
        volta: volta ? volta.segments?.map(seg => ({
          origem: seg.departure?.iataCode,
          destino: seg.arrival?.iataCode,
          partida: seg.departure?.at,
          chegada: seg.arrival?.at,
          duracao: seg.duration,
          companhia: companhiaMap[seg.carrierCode] || seg.carrierCode,
          numeroVoo: seg.number
        })) : null
      },
      linkReserva: offer.source || 'AMADEUS'
    };
  });
}

// Calcular duração total do itinerário
function calculateDuration(itinerary) {
  if (!itinerary.segments || itinerary.segments.length === 0) {
    return '0h 0m';
  }
  
  const totalMinutes = itinerary.duration?.match(/(\d+)H(\d+)?M/);
  if (totalMinutes) {
    const hours = parseInt(totalMinutes[1]) || 0;
    const minutes = parseInt(totalMinutes[2]) || 0;
    return `${hours}h ${minutes}m`;
  }
  
  return itinerary.duration || 'N/A';
}

// Gerar dados mock para desenvolvimento
function generateMockFlights(origem, destino, dataIda, dataVolta) {
  const companhias = ['LATAM', 'GOL', 'Azul', 'TAM', 'Emirates', 'Air France', 'KLM', 'Lufthansa', 'TAP', 'Qatar Airways', 'American Airlines', 'Delta', 'United', 'British Airways', 'Iberia'];
  const voos = [];
  
  for (let i = 0; i < 15; i++) {
    const companhia = companhias[Math.floor(Math.random() * companhias.length)];
    const precoBase = 800 + Math.random() * 2000;
    const escalas = Math.random() > 0.6 ? 0 : 1;
    
    const dataIdaObj = new Date(dataIda);
    const horaPartida = 6 + Math.floor(Math.random() * 14);
    const minutoPartida = Math.floor(Math.random() * 60);
    
    voos.push({
      id: `mock-flight-${i}`,
      preco: precoBase.toFixed(2),
      moeda: 'BRL',
      companhia: companhia,
      origem: origem.substring(0, 3).toUpperCase(),
      destino: destino.substring(0, 3).toUpperCase(),
      dataIda: new Date(dataIdaObj.setHours(horaPartida, minutoPartida)).toISOString(),
      dataVolta: dataVolta ? new Date(dataVolta).toISOString() : null,
      duracaoIda: `${Math.floor(Math.random() * 8) + 2}h ${Math.floor(Math.random() * 60)}m`,
      duracaoVolta: dataVolta ? `${Math.floor(Math.random() * 8) + 2}h ${Math.floor(Math.random() * 60)}m` : null,
      escalasIda: escalas,
      escalasVolta: dataVolta ? escalas : null,
      detalhes: {
        ida: [{
          origem: origem.substring(0, 3).toUpperCase(),
          destino: destino.substring(0, 3).toUpperCase(),
          partida: new Date(dataIdaObj.setHours(horaPartida, minutoPartida)).toISOString(),
          chegada: new Date(dataIdaObj.getTime() + (2 + Math.random() * 6) * 3600000).toISOString(),
          duracao: `${Math.floor(Math.random() * 8) + 2}H${Math.floor(Math.random() * 60)}M`,
          companhia: companhia.substring(0, 2).toUpperCase(),
          numeroVoo: `${companhia.substring(0, 2)}${Math.floor(Math.random() * 9000) + 1000}`
        }],
        volta: dataVolta ? [{
          origem: destino.substring(0, 3).toUpperCase(),
          destino: origem.substring(0, 3).toUpperCase(),
          partida: new Date(dataVolta).toISOString(),
          chegada: new Date(new Date(dataVolta).getTime() + (2 + Math.random() * 6) * 3600000).toISOString(),
          duracao: `${Math.floor(Math.random() * 8) + 2}H${Math.floor(Math.random() * 60)}M`,
          companhia: companhia.substring(0, 2).toUpperCase(),
          numeroVoo: `${companhia.substring(0, 2)}${Math.floor(Math.random() * 9000) + 1000}`
        }] : null
      },
      linkReserva: 'MOCK'
    });
  }
  
  return voos.sort((a, b) => parseFloat(a.preco) - parseFloat(b.preco));
}

// Função principal de busca
async function searchFlights(origem, destino, dataIda, dataVolta) {
  // Verificar se Multi-API está habilitado (pelo menos uma API configurada)
  const useMultiAPI = API_CONFIG.travellink.enabled || API_CONFIG.amadeus.enabled || API_CONFIG.aviationstack.enabled;
  
  // Se explicitamente configurado para usar mock, usar mock
  if (USE_MOCK_DATA && !useMultiAPI) {
    console.log('⚠️ [FlightsService] Usando dados MOCK de voos');
    console.log('⚠️ [FlightsService] Para usar API real, configure AMADEUS_API_KEY e AMADEUS_API_SECRET no arquivo .env');
    return generateMockFlights(origem, destino, dataIda, dataVolta);
  }
  
  // Tentar usar Multi-API primeiro (mais preciso)
  if (useMultiAPI) {
    try {
      console.log('🔍 [FlightsService] Buscando voos usando sistema Multi-API...');
      const resultado = await searchFlightsMultiAPI(origem, destino, dataIda, dataVolta);
      
      if (resultado.voos.length === 0) {
        console.log('⚠️ [FlightsService] Nenhum voo encontrado nas APIs. Verifique origem, destino e datas.');
        
        // Se USE_MOCK_FLIGHTS está habilitado, usar fallback
        if (USE_MOCK_FLIGHTS) {
          console.log('⚠️ [FlightsService] Usando dados mock como fallback...');
          return generateMockFlights(origem, destino, dataIda, dataVolta);
        }
        
        // Retornar array vazio em vez de lançar erro (não é erro, apenas não há voos)
        console.log('ℹ️ [FlightsService] Retornando array vazio - nenhum voo encontrado');
        return [];
      }
      
      console.log(`✅ [FlightsService] ${resultado.voos.length} voo(s) encontrado(s) via Multi-API`);
      console.log(`📊 [FlightsService] Estatísticas:`, resultado.estatisticas);
      
      // Retornar apenas os voos (sem estatísticas para compatibilidade)
      return resultado.voos;
    } catch (error) {
      console.error('❌ [FlightsService] Erro ao buscar voos via Multi-API:', error.message);
      
      // Fallback para busca Amadeus direta
      if (API_CONFIG.amadeus.enabled) {
        try {
          console.log('🔄 [FlightsService] Tentando busca direta na Amadeus...');
          const voos = await searchFlightsAmadeus(origem, destino, dataIda, dataVolta);
          if (voos.length > 0) {
            console.log(`✅ [FlightsService] ${voos.length} voo(s) encontrado(s) na Amadeus`);
            return voos;
          }
        } catch (amadeusError) {
          console.error('❌ [FlightsService] Erro na busca direta Amadeus:', amadeusError.message);
        }
      }
      
      // Se USE_MOCK_FLIGHTS está habilitado, usar fallback
      if (USE_MOCK_FLIGHTS) {
        console.log('⚠️ [FlightsService] Usando dados mock como fallback...');
        return generateMockFlights(origem, destino, dataIda, dataVolta);
      }
      
      throw error;
    }
  }
  
  // Fallback: busca Amadeus direta (compatibilidade com código antigo)
  try {
    console.log('🔍 [FlightsService] Buscando voos REAIS na API Amadeus...');
    const voos = await searchFlightsAmadeus(origem, destino, dataIda, dataVolta);
    
    if (voos.length === 0) {
      console.log('⚠️ [FlightsService] Nenhum voo encontrado na API. Verifique origem, destino e datas.');
      throw new Error('Nenhum voo encontrado para os critérios informados.');
    }
    
    console.log(`✅ [FlightsService] ${voos.length} voo(s) REAL(is) encontrado(s) na API Amadeus`);
    return voos;
  } catch (error) {
    console.error('❌ [FlightsService] Erro ao buscar voos na API Amadeus:', error.message);
    
    if (USE_MOCK_FLIGHTS) {
      console.log('⚠️ [FlightsService] Usando dados mock como fallback...');
      return generateMockFlights(origem, destino, dataIda, dataVolta);
    }
    
    throw error;
  }
}

module.exports = {
  searchFlights,
  getCityCode
};

