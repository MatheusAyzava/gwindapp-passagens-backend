// Sistema Multi-API para Busca de Voos
// Integra múltiplas fontes de dados para maior precisão e confiabilidade

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const soap = require('soap');

// ============================================
// CONFIGURAÇÃO DAS APIs
// ============================================

const API_CONFIG = {
  amadeus: {
    enabled: process.env.AMADEUS_API_KEY && process.env.AMADEUS_API_SECRET,
    key: process.env.AMADEUS_API_KEY || '',
    secret: process.env.AMADEUS_API_SECRET || '',
    env: process.env.AMADEUS_ENV || 'test',
    priority: 1 // Prioridade alta
  },
  
  aviationstack: {
    enabled: process.env.AVIATIONSTACK_API_KEY && process.env.AVIATIONSTACK_API_KEY !== '',
    key: process.env.AVIATIONSTACK_API_KEY || '',
    priority: 2 // Prioridade média
  },
  
  travellink: {
    enabled: true, // API TravelLink/Wooba sempre habilitada (sandbox público)
    wsdlUrl: 'http://wooba-sandbox-api.travellink.com.br/wcftravellinkJson/AereoNoSession.svc?wsdl',
    serviceUrl: 'http://wooba-sandbox-api.travellink.com.br/wcftravellinkJson/AereoNoSession.svc',
    priority: 1 // Prioridade alta - API principal agora
  }
};

// ============================================
// CACHE DE TOKENS
// ============================================

let amadeusToken = null;
let amadeusTokenExpiry = null;

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

// Obter token Amadeus
async function getAmadeusToken() {
  if (amadeusToken && amadeusTokenExpiry && Date.now() < amadeusTokenExpiry) {
    return amadeusToken;
  }

  try {
    const apiBaseUrl = API_CONFIG.amadeus.env === 'production' 
      ? 'https://api.amadeus.com'
      : 'https://test.api.amadeus.com';
    
    const response = await axios.post(
      `${apiBaseUrl}/v1/security/oauth2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: API_CONFIG.amadeus.key,
        client_secret: API_CONFIG.amadeus.secret
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    );

    amadeusToken = response.data.access_token;
    amadeusTokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
    return amadeusToken;
  } catch (error) {
    console.error('[MultiAPI] Erro ao obter token Amadeus:', error.message);
    throw error;
  }
}

// Converter cidade para código IATA
function getCityCode(city) {
  if (/^[A-Z]{3}$/.test(city.trim().toUpperCase())) {
    return city.trim().toUpperCase();
  }

  const cityMap = {
    'são paulo': 'SAO', 'sao paulo': 'SAO',
    'rio de janeiro': 'RIO', 'rio': 'RIO',
    'brasília': 'BSB', 'brasilia': 'BSB',
    'salvador': 'SSA', 'fortaleza': 'FOR',
    'belo horizonte': 'CNF', 'manaus': 'MAO',
    'curitiba': 'CWB', 'porto alegre': 'POA',
    'recife': 'REC', 'belém': 'BEL', 'belem': 'BEL',
    'goiânia': 'GYN', 'goiania': 'GYN',
    'vitória': 'VIX', 'vitoria': 'VIX',
    'florianópolis': 'FLN', 'florianopolis': 'FLN',
    'campinas': 'VCP', 'guarulhos': 'GRU',
    'congonhas': 'CGH', 'santos dumont': 'SDU'
  };

  const normalized = city.toLowerCase().trim();
  return cityMap[normalized] || city.substring(0, 3).toUpperCase();
}

// Normalizar formato de voo para padronização
function normalizeFlight(flight, source) {
  const normalized = {
    id: flight.id || `${source}-${Date.now()}-${Math.random()}`,
    preco: parseFloat(flight.preco) || 0,
    moeda: flight.moeda || 'BRL',
    companhia: flight.companhia || 'N/A',
    origem: flight.origem || '',
    destino: flight.destino || '',
    dataIda: flight.dataIda || '',
    dataVolta: flight.dataVolta || null,
    duracaoIda: flight.duracaoIda || 'N/A',
    duracaoVolta: flight.duracaoVolta || null,
    escalasIda: flight.escalasIda || 0,
    escalasVolta: flight.escalasVolta || null,
    detalhes: flight.detalhes || {},
    linkReserva: flight.linkReserva || source,
    fonte: source, // Identificar a fonte
    confiabilidade: calculateReliability(flight, source)
  };
  
  // Preservar objeto original se existir
  if (flight._originalOffer) {
    normalized._originalOffer = flight._originalOffer;
  }
  
  return normalized;
}

// Calcular confiabilidade baseado na fonte e dados
function calculateReliability(flight, source) {
  let score = 0.5; // Base
  
  // Pontuação por fonte
  if (source === 'TRAVELLINK') score += 0.4; // API principal
  else if (source === 'AMADEUS') score += 0.3;
  else if (source === 'AVIATIONSTACK') score += 0.2;
  
  // Pontuação por completude dos dados
  if (flight.detalhes && flight.detalhes.ida && flight.detalhes.ida.length > 0) score += 0.1;
  if (flight.preco && parseFloat(flight.preco) > 0) score += 0.1;
  
  return Math.min(1.0, score);
}

// Remover duplicatas (mesmo voo de fontes diferentes)
function deduplicateFlights(flights) {
  const seen = new Map();
  const unique = [];
  
  for (const flight of flights) {
    // Criar chave única baseada em: origem, destino, data, hora aproximada, companhia
    const key = `${flight.origem}-${flight.destino}-${flight.dataIda?.substring(0, 10)}-${flight.companhia}`;
    
    if (!seen.has(key)) {
      seen.set(key, flight);
      unique.push(flight);
    } else {
      // Se já existe, manter o mais confiável ou com mais detalhes
      const existing = seen.get(key);
      if (flight.confiabilidade > existing.confiabilidade || 
          (flight.detalhes?.ida?.length || 0) > (existing.detalhes?.ida?.length || 0)) {
        seen.set(key, flight);
        // Substituir na lista
        const index = unique.findIndex(f => f.id === existing.id);
        if (index !== -1) unique[index] = flight;
      }
    }
  }
  
  return unique;
}

// Calcular duração
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

// ============================================
// IMPLEMENTAÇÃO DAS APIs
// ============================================

// 1. AMADEUS API
async function searchAmadeus(origem, destino, dataIda, dataVolta) {
  if (!API_CONFIG.amadeus.enabled) {
    return [];
  }

  try {
    const token = await getAmadeusToken();
    const origemCode = getCityCode(origem);
    const destinoCode = getCityCode(destino);
    const dataIdaFormatted = new Date(dataIda).toISOString().split('T')[0];
    const dataVoltaFormatted = dataVolta ? new Date(dataVolta).toISOString().split('T')[0] : null;

    const apiBaseUrl = API_CONFIG.amadeus.env === 'production' 
      ? 'https://api.amadeus.com'
      : 'https://test.api.amadeus.com';

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

    const response = await axios.get(
      `${apiBaseUrl}/v2/shopping/flight-offers`,
      {
        headers: { 'Authorization': `Bearer ${token}` },
        params,
        timeout: 15000
      }
    );

    if (!response.data?.data || response.data.data.length === 0) {
      return [];
    }

    // Formatar resultados Amadeus
    const companhiaMap = {
      'LA': 'LATAM', 'G3': 'GOL', 'AD': 'Azul', 'JJ': 'LATAM',
      'TP': 'TAP', 'AF': 'Air France', 'KL': 'KLM', 'LH': 'Lufthansa',
      'EK': 'Emirates', 'QR': 'Qatar Airways', 'AA': 'American Airlines',
      'DL': 'Delta', 'UA': 'United', 'BA': 'British Airways'
    };

    return response.data.data.map((offer, index) => {
      const itineraries = offer.itineraries || [];
      const ida = itineraries[0] || {};
      const volta = itineraries[1] || null;
      const primeiraCompanhia = ida.segments?.[0]?.carrierCode || 'N/A';

      return normalizeFlight({
        id: offer.id || `amadeus-${index}`,
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
        linkReserva: 'AMADEUS',
        // Manter o objeto original da oferta para confirmação de preço
        _originalOffer: offer
      }, 'AMADEUS');
    });
  } catch (error) {
    console.error('[MultiAPI] Erro ao buscar na Amadeus:', error.message);
    return [];
  }
}

// 2. TRAVELLINK/WOOBA API (API Principal - SOAP/WCF)
async function searchTravelLink(origem, destino, dataIda, dataVolta) {
  if (!API_CONFIG.travellink.enabled) {
    return [];
  }

  try {
    const origemCode = getCityCode(origem);
    const destinoCode = getCityCode(destino);
    
    // Formatar data para YYYY-MM-DD
    const dataIdaFormatted = new Date(dataIda).toISOString().split('T')[0];
    const dataVoltaFormatted = dataVolta ? new Date(dataVolta).toISOString().split('T')[0] : null;

    console.log(`[MultiAPI] Buscando voos na TravelLink: ${origemCode} → ${destinoCode} em ${dataIdaFormatted}`);

    // Criar cliente SOAP
    const client = await soap.createClientAsync(API_CONFIG.travellink.wsdlUrl, {
      endpoint: API_CONFIG.travellink.serviceUrl,
      timeout: 30000
    });

    // Usar o método DisponibilidadeAsync (versão correta para Promises)
    if (!client.DisponibilidadeAsync) {
      // Se não tiver Async, tentar criar uma Promise wrapper
      if (!client.Disponibilidade) {
        throw new Error('Método Disponibilidade não encontrado na API TravelLink');
      }
    }

    // Preparar parâmetros para o método Disponibilidade
    // A API TravelLink espera parâmetros específicos para Disponibilidade
    const params = {
      origem: origemCode,
      destino: destinoCode,
      dataIda: dataIdaFormatted,
      adultos: 1,
      criancas: 0,
      bebes: 0
    };

    if (dataVoltaFormatted) {
      params.dataVolta = dataVoltaFormatted;
    }

    console.log(`[MultiAPI] Chamando método Disponibilidade com parâmetros:`, JSON.stringify(params, null, 2));
    
    // Chamar o método Disponibilidade usando Async (versão correta)
    let resultado = null;
    try {
      // Usar DisponibilidadeAsync que retorna Promise
      if (client.DisponibilidadeAsync) {
        console.log('[MultiAPI] Usando DisponibilidadeAsync...');
        resultado = await client.DisponibilidadeAsync(params);
      } else {
        // Se não tiver Async, criar Promise wrapper
        console.log('[MultiAPI] Convertendo Disponibilidade para Promise...');
        resultado = await new Promise((resolve, reject) => {
          client.Disponibilidade(params, (err, result) => {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
          });
        });
      }
      
      console.log('[MultiAPI] Resposta recebida do método Disponibilidade');
      console.log('[MultiAPI] Tipo do resultado:', typeof resultado);
      console.log('[MultiAPI] É array?', Array.isArray(resultado));
      
      if (resultado && typeof resultado === 'object') {
        console.log('[MultiAPI] Chaves do resultado:', Object.keys(resultado));
      }
    } catch (err) {
      console.error('[MultiAPI] Erro ao chamar Disponibilidade:', err.message);
      console.error('[MultiAPI] Detalhes do erro:', err.response?.data || err.body || err);
      
      // Se o erro for sobre callback, tentar outra abordagem
      if (err.message && err.message.includes('callback')) {
        console.log('[MultiAPI] Erro de callback detectado, tentando abordagem alternativa...');
        // Retornar array vazio em vez de crashar
        return [];
      }
      
      throw new Error(`Erro ao buscar disponibilidade: ${err.message}`);
    }

    // Verificar se resultado é válido (pode ser array vazio ou objeto vazio)
    if (resultado === null || resultado === undefined) {
      console.log('[MultiAPI] Resultado é null/undefined, retornando array vazio');
      return [];
    }
    
    // Se resultado for array vazio, retornar
    if (Array.isArray(resultado) && resultado.length === 0) {
      console.log('[MultiAPI] Resultado é array vazio');
      return [];
    }
    
    // Log do resultado (limitado para não sobrecarregar)
    if (resultado && typeof resultado === 'object') {
      const resultadoStr = JSON.stringify(resultado, null, 2);
      console.log('[MultiAPI] Resultado (primeiros 1000 chars):', resultadoStr.substring(0, 1000));
    }

    // Processar resultado (estrutura pode variar)
    const voos = processarResultadosTravelLink(resultado, origemCode, destinoCode);
    
    console.log(`[MultiAPI] TravelLink: ${voos.length} voo(s) encontrado(s)`);
    
    // Se não encontrou voos, retornar array vazio (não é erro)
    if (voos.length === 0) {
      console.log('[MultiAPI] Nenhum voo encontrado na TravelLink para os critérios informados');
    }
    
    return voos;
  } catch (error) {
    console.error('[MultiAPI] Erro ao buscar na TravelLink:', error.message);
    console.error('[MultiAPI] Stack:', error.stack);
    return [];
  }
}

// Processar resultados da API TravelLink
function processarResultadosTravelLink(resultado, origemCode, destinoCode) {
  const voos = [];
  
  try {
    // Tentar diferentes estruturas de resposta da API TravelLink
    console.log('[MultiAPI] Processando resultado da API TravelLink...');
    console.log('[MultiAPI] Chaves do resultado:', Object.keys(resultado || {}));
    
    let dados = null;
    
    // Estruturas comuns da API TravelLink
    if (resultado.DisponibilidadeResult) {
      dados = resultado.DisponibilidadeResult;
      console.log('[MultiAPI] Usando DisponibilidadeResult');
    } else if (resultado.disponibilidadeResult) {
      dados = resultado.disponibilidadeResult;
      console.log('[MultiAPI] Usando disponibilidadeResult');
    } else if (resultado.return) {
      dados = resultado.return;
      console.log('[MultiAPI] Usando return');
    } else if (resultado.data) {
      dados = resultado.data;
      console.log('[MultiAPI] Usando data');
    } else if (resultado.Voos) {
      dados = resultado.Voos;
      console.log('[MultiAPI] Usando Voos');
    } else if (resultado.voos) {
      dados = resultado.voos;
      console.log('[MultiAPI] Usando voos');
    } else if (resultado.Flights) {
      dados = resultado.Flights;
      console.log('[MultiAPI] Usando Flights');
    } else if (resultado.flights) {
      dados = resultado.flights;
      console.log('[MultiAPI] Usando flights');
    } else if (Array.isArray(resultado)) {
      dados = resultado;
      console.log('[MultiAPI] Resultado é um array direto');
    } else {
      dados = resultado;
      console.log('[MultiAPI] Usando resultado completo');
    }
    
    console.log('[MultiAPI] Tipo de dados:', typeof dados, Array.isArray(dados) ? '(array)' : '(objeto)');
    if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
      console.log('[MultiAPI] Chaves dos dados:', Object.keys(dados));
    }

    // Se dados for null/undefined ou array vazio, retornar array vazio
    if (!dados || (Array.isArray(dados) && dados.length === 0)) {
      console.log('[MultiAPI] Dados vazios ou nulos, nenhum voo para processar');
      return [];
    }
    
    // Se for array, processar cada item
    if (Array.isArray(dados)) {
      console.log(`[MultiAPI] Processando ${dados.length} voo(s) do array`);
      dados.forEach((voo, index) => {
        if (voo && typeof voo === 'object') {
          voos.push(formatarVooTravelLink(voo, origemCode, destinoCode, index));
        }
      });
    } 
    // Se for objeto com array interno
    else if (dados && typeof dados === 'object') {
      const listaVoos = dados.Voos || dados.voos || dados.flights || dados.resultado || dados.ListaVoos || dados.listaVoos;
      if (Array.isArray(listaVoos) && listaVoos.length > 0) {
        console.log(`[MultiAPI] Processando ${listaVoos.length} voo(s) do objeto`);
        listaVoos.forEach((voo, index) => {
          if (voo && typeof voo === 'object') {
            voos.push(formatarVooTravelLink(voo, origemCode, destinoCode, index));
          }
        });
      } else if (Object.keys(dados).length > 0 && !Array.isArray(dados)) {
        // Se for objeto único com dados, tentar processar como um voo
        console.log('[MultiAPI] Processando objeto único como voo');
        voos.push(formatarVooTravelLink(dados, origemCode, destinoCode, 0));
      } else {
        console.log('[MultiAPI] Objeto vazio ou sem dados de voos');
      }
    }
  } catch (error) {
    console.error('[MultiAPI] Erro ao processar resultados TravelLink:', error.message);
  }

  return voos;
}

// Formatar voo da TravelLink para formato padrão
function formatarVooTravelLink(voo, origemCode, destinoCode, index) {
  const companhiaMap = {
    'LA': 'LATAM', 'G3': 'GOL', 'AD': 'Azul', 'JJ': 'LATAM',
    'TP': 'TAP', 'AF': 'Air France', 'KL': 'KLM', 'LH': 'Lufthansa',
    'EK': 'Emirates', 'QR': 'Qatar Airways', 'AA': 'American Airlines',
    'DL': 'Delta', 'UA': 'United', 'BA': 'British Airways'
  };

  // Extrair dados do voo (estrutura pode variar)
  const companhia = voo.Companhia || voo.companhia || voo.Airline || voo.airline || 'N/A';
  const preco = voo.Preco || voo.preco || voo.Price || voo.price || voo.Valor || voo.valor || '0';
  const moeda = voo.Moeda || voo.moeda || voo.Currency || voo.currency || 'BRL';
  const dataPartida = voo.DataPartida || voo.dataPartida || voo.DepartureDate || voo.departureDate || '';
  const horaPartida = voo.HoraPartida || voo.horaPartida || voo.DepartureTime || voo.departureTime || '';
  const horaChegada = voo.HoraChegada || voo.horaChegada || voo.ArrivalTime || voo.arrivalTime || '';
  const duracao = voo.Duracao || voo.duracao || voo.Duration || voo.duration || 'N/A';
  const escalas = voo.Escalas || voo.escalas || voo.Stops || voo.stops || 0;
  const numeroVoo = voo.NumeroVoo || voo.numeroVoo || voo.FlightNumber || voo.flightNumber || '';

  return normalizeFlight({
    id: voo.Id || voo.id || `travellink-${index}-${Date.now()}`,
    preco: parseFloat(preco) || 0,
    moeda: moeda,
    companhia: companhiaMap[companhia] || companhia,
    origem: voo.Origem || voo.origem || origemCode,
    destino: voo.Destino || voo.destino || destinoCode,
    dataIda: dataPartida ? `${dataPartida}T${horaPartida}:00` : new Date().toISOString(),
    dataVolta: null,
    duracaoIda: duracao || 'N/A',
    duracaoVolta: null,
    escalasIda: parseInt(escalas) || 0,
    escalasVolta: null,
    detalhes: {
      ida: [{
        origem: voo.Origem || voo.origem || origemCode,
        destino: voo.Destino || voo.destino || destinoCode,
        partida: dataPartida ? `${dataPartida}T${horaPartida}:00` : '',
        chegada: horaChegada ? `${dataPartida}T${horaChegada}:00` : '',
        duracao: duracao,
        companhia: companhiaMap[companhia] || companhia,
        numeroVoo: numeroVoo
      }]
    },
    linkReserva: 'TRAVELLINK',
    _originalOffer: voo
  }, 'TRAVELLINK');
}

// 3. AVIATIONSTACK API (validação de rotas)
async function searchAviationStack(origem, destino, dataIda, dataVolta) {
  if (!API_CONFIG.aviationstack.enabled) {
    return [];
  }

  try {
    const origemCode = getCityCode(origem);
    const destinoCode = getCityCode(destino);
    const dataIdaFormatted = new Date(dataIda).toISOString().split('T')[0];

    // Aviationstack retorna dados de voos, mas não preços completos
    // Pode ser usado para validar existência de rotas
    const response = await axios.get(
      'http://api.aviationstack.com/v1/flights',
      {
        params: {
          access_key: API_CONFIG.aviationstack.key,
          dep_iata: origemCode,
          arr_iata: destinoCode,
          flight_date: dataIdaFormatted
        },
        timeout: 10000
      }
    );

    if (!response.data?.data || response.data.data.length === 0) {
      return [];
    }

    // Formatar resultados (limitado, pois não tem preços completos)
    return response.data.data.slice(0, 10).map((flight, index) => {
      return normalizeFlight({
        id: `aviationstack-${index}`,
        preco: '0', // Aviationstack não fornece preços
        moeda: 'BRL',
        companhia: flight.airline?.name || flight.airline?.iata || 'N/A',
        origem: flight.departure?.iata || origemCode,
        destino: flight.arrival?.iata || destinoCode,
        dataIda: flight.departure?.scheduled || '',
        dataVolta: null,
        duracaoIda: 'N/A',
        duracaoVolta: null,
        escalasIda: 0,
        escalasVolta: null,
        detalhes: {
          ida: [{
            origem: flight.departure?.iata,
            destino: flight.arrival?.iata,
            partida: flight.departure?.scheduled,
            chegada: flight.arrival?.scheduled,
            duracao: 'N/A',
            companhia: flight.airline?.name,
            numeroVoo: flight.flight?.number
          }]
        },
        linkReserva: 'AVIATIONSTACK'
      }, 'AVIATIONSTACK');
    });
  } catch (error) {
    console.error('[MultiAPI] Erro ao buscar na Aviationstack:', error.message);
    return [];
  }
}

// ============================================
// FUNÇÃO PRINCIPAL - BUSCA MULTI-API
// ============================================

async function searchFlightsMultiAPI(origem, destino, dataIda, dataVolta) {
  console.log('[MultiAPI] Iniciando busca multi-API...');
  console.log(`[MultiAPI] Parâmetros: ${origem} → ${destino}, ${dataIda}${dataVolta ? ` - ${dataVolta}` : ''}`);
  
  const results = [];
  const errors = [];
  
  // Buscar de todas as APIs disponíveis em paralelo
  const promises = [];
  
  // TravelLink/Wooba - API Principal (prioridade)
  if (API_CONFIG.travellink.enabled) {
    console.log('[MultiAPI] Buscando na TravelLink/Wooba (API Principal)...');
    promises.push(
      searchTravelLink(origem, destino, dataIda, dataVolta)
        .then(flights => {
          console.log(`[MultiAPI] TravelLink: ${flights.length} voo(s) encontrado(s)`);
          results.push(...flights);
        })
        .catch(err => {
          console.error('[MultiAPI] Erro na TravelLink:', err.message);
          errors.push({ source: 'TRAVELLINK', error: err.message });
        })
    );
  }
  
  if (API_CONFIG.amadeus.enabled) {
    console.log('[MultiAPI] Buscando na Amadeus...');
    promises.push(
      searchAmadeus(origem, destino, dataIda, dataVolta)
        .then(flights => {
          console.log(`[MultiAPI] Amadeus: ${flights.length} voo(s) encontrado(s)`);
          results.push(...flights);
        })
        .catch(err => {
          console.error('[MultiAPI] Erro na Amadeus:', err.message);
          errors.push({ source: 'AMADEUS', error: err.message });
        })
    );
  }
  
  if (API_CONFIG.aviationstack.enabled) {
    console.log('[MultiAPI] Buscando na Aviationstack...');
    promises.push(
      searchAviationStack(origem, destino, dataIda, dataVolta)
        .then(flights => {
          console.log(`[MultiAPI] Aviationstack: ${flights.length} voo(s) encontrado(s)`);
          results.push(...flights);
        })
        .catch(err => {
          console.error('[MultiAPI] Erro na Aviationstack:', err.message);
          errors.push({ source: 'AVIATIONSTACK', error: err.message });
        })
    );
  }
  
  // Aguardar todas as buscas
  await Promise.allSettled(promises);
  
  // Remover duplicatas
  const uniqueFlights = deduplicateFlights(results);
  
  // Ordenar por confiabilidade e preço
  uniqueFlights.sort((a, b) => {
    // Primeiro por confiabilidade (maior primeiro)
    if (b.confiabilidade !== a.confiabilidade) {
      return b.confiabilidade - a.confiabilidade;
    }
    // Depois por preço (menor primeiro)
    return a.preco - b.preco;
  });
  
  console.log(`[MultiAPI] Total: ${uniqueFlights.length} voo(s) único(s) encontrado(s)`);
  if (errors.length > 0) {
    console.log(`[MultiAPI] ${errors.length} erro(s) durante a busca`);
  }
  
  return {
    voos: uniqueFlights,
    estatisticas: {
      total: uniqueFlights.length,
      fontes: {
        travellink: uniqueFlights.filter(f => f.fonte === 'TRAVELLINK').length,
        amadeus: uniqueFlights.filter(f => f.fonte === 'AMADEUS').length,
        aviationstack: uniqueFlights.filter(f => f.fonte === 'AVIATIONSTACK').length
      },
      erros: errors
    }
  };
}

// ============================================
// CONFIRMAÇÃO DE PREÇOS EM TEMPO REAL
// ============================================

// Confirmar preço de uma oferta de voo usando Flight Offers Pricing API
async function confirmFlightPrice(flightOffer) {
  if (!API_CONFIG.amadeus.enabled) {
    throw new Error('API Amadeus não configurada');
  }

  try {
    const token = await getAmadeusToken();
    const apiBaseUrl = API_CONFIG.amadeus.env === 'production' 
      ? 'https://api.amadeus.com'
      : 'https://test.api.amadeus.com';

    console.log('[MultiAPI] Confirmando preço do voo:', flightOffer.id);

    // Preparar o corpo da requisição conforme documentação da Amadeus
    const requestBody = {
      data: {
        type: 'flight-offers-pricing',
        flightOffers: [flightOffer]
      }
    };

    const response = await axios.post(
      `${apiBaseUrl}/v1/shopping/flight-offers-pricing`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/vnd.amadeus+json',
          'X-HTTP-Method-Override': 'GET'
        },
        params: {
          include: 'bags,other-services'
        },
        timeout: 20000 // 20 segundos para pricing
      }
    );

    if (!response.data?.data?.flightOffers || response.data.data.flightOffers.length === 0) {
      throw new Error('Nenhuma oferta de preço confirmada retornada');
    }

    const confirmedOffer = response.data.data.flightOffers[0];
    
    console.log('[MultiAPI] Preço confirmado:', {
      id: confirmedOffer.id,
      precoAnterior: flightOffer.price?.total,
      precoConfirmado: confirmedOffer.price?.total,
      moeda: confirmedOffer.price?.currency
    });

    return {
      id: confirmedOffer.id,
      preco: confirmedOffer.price?.total || flightOffer.price?.total,
      precoBase: confirmedOffer.price?.base || flightOffer.price?.base,
      moeda: confirmedOffer.price?.currency || flightOffer.price?.currency,
      grandTotal: confirmedOffer.price?.grandTotal || confirmedOffer.price?.total,
      taxas: confirmedOffer.price?.fees || [],
      ultimaDataEmissao: confirmedOffer.lastTicketingDate,
      assentosDisponiveis: confirmedOffer.numberOfBookableSeats,
      requerEmissaoImediata: confirmedOffer.instantTicketingRequired || false,
      detalhesPreco: confirmedOffer.travelerPricings || [],
      opcoesBolsas: response.data.data?.flightOffers?.[0]?.travelerPricings?.[0]?.fareDetailsBySegment || [],
      confirmado: true,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[MultiAPI] Erro ao confirmar preço:', error.response?.data || error.message);
    
    if (error.response?.status === 400) {
      const errorDetail = error.response?.data?.errors?.[0]?.detail || 'Parâmetros inválidos';
      throw new Error(`Erro ao confirmar preço: ${errorDetail}`);
    } else if (error.response?.status === 404) {
      throw new Error('Oferta de voo não encontrada ou expirada');
    } else if (error.response?.status === 429) {
      throw new Error('Limite de requisições excedido. Tente novamente mais tarde.');
    }
    
    throw new Error(`Erro ao confirmar preço: ${error.message}`);
  }
}

// Confirmar preços de múltiplos voos em paralelo
async function confirmMultipleFlightPrices(flightOffers) {
  if (!Array.isArray(flightOffers) || flightOffers.length === 0) {
    return [];
  }

  console.log(`[MultiAPI] Confirmando preços de ${flightOffers.length} voo(s)...`);

  // Limitar a 5 voos por vez para evitar rate limiting
  const offersToConfirm = flightOffers.slice(0, 5);
  
  const promises = offersToConfirm.map((offer, index) => 
    confirmFlightPrice(offer)
      .then(result => ({ index, result, success: true }))
      .catch(error => ({ index, error: error.message, success: false }))
  );

  const results = await Promise.allSettled(promises);
  
  const confirmed = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      confirmed.push({
        ...flightOffers[index],
        precoConfirmado: result.value.result,
        precoOriginal: flightOffers[index].price?.total
      });
    }
  });

  console.log(`[MultiAPI] ${confirmed.length} de ${offersToConfirm.length} preço(s) confirmado(s)`);
  
  return confirmed;
}

module.exports = {
  searchFlightsMultiAPI,
  confirmFlightPrice,
  confirmMultipleFlightPrices,
  getCityCode,
  API_CONFIG
};

