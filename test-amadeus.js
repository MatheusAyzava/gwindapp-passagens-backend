// Script de teste para verificar conexão com Amadeus API
require('dotenv').config();
const axios = require('axios');

const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY;
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET;

console.log('=== Teste de Conexão Amadeus API ===\n');
console.log('API Key:', AMADEUS_API_KEY ? AMADEUS_API_KEY.substring(0, 10) + '...' : 'NÃO ENCONTRADA');
console.log('API Secret:', AMADEUS_API_SECRET ? '***' + AMADEUS_API_SECRET.substring(AMADEUS_API_SECRET.length - 3) : 'NÃO ENCONTRADA');
console.log('');

if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
  console.error('❌ ERRO: Credenciais não encontradas!');
  console.error('Verifique se o arquivo .env existe na raiz do projeto e contém:');
  console.error('AMADEUS_API_KEY=sua_chave');
  console.error('AMADEUS_API_SECRET=seu_secret');
  process.exit(1);
}

console.log('Testando autenticação...\n');

axios.post(
  'https://test.api.amadeus.com/v1/security/oauth2/token',
  new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AMADEUS_API_KEY,
    client_secret: AMADEUS_API_SECRET
  }),
  {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    timeout: 10000
  }
)
.then(response => {
  console.log('✅ Autenticação bem-sucedida!');
  console.log('Token obtido:', response.data.access_token.substring(0, 20) + '...');
  console.log('Expira em:', response.data.expires_in, 'segundos');
  
  // Testar busca de voos
  console.log('\nTestando busca de voos (GRU -> SDU)...');
  
  return axios.get(
    'https://test.api.amadeus.com/v2/shopping/flight-offers',
    {
      headers: {
        'Authorization': `Bearer ${response.data.access_token}`
      },
      params: {
        originLocationCode: 'GRU',
        destinationLocationCode: 'SDU',
        departureDate: '2025-12-25',
        adults: 1,
        max: 5
      },
      timeout: 15000
    }
  );
})
.then(response => {
  console.log('✅ Busca de voos bem-sucedida!');
  console.log('Voos encontrados:', response.data.data?.length || 0);
  if (response.data.data && response.data.data.length > 0) {
    const primeiroVoo = response.data.data[0];
    console.log('\nPrimeiro voo:');
    console.log('- Companhia:', primeiroVoo.itineraries[0]?.segments[0]?.carrierCode);
    console.log('- Preço:', primeiroVoo.price?.total, primeiroVoo.price?.currency);
    console.log('- Origem:', primeiroVoo.itineraries[0]?.segments[0]?.departure?.iataCode);
    console.log('- Destino:', primeiroVoo.itineraries[0]?.segments[primeiroVoo.itineraries[0].segments.length - 1]?.arrival?.iataCode);
  }
  console.log('\n✅ Tudo funcionando corretamente!');
  process.exit(0);
})
.catch(error => {
  console.error('\n❌ ERRO:', error.message);
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Resposta:', JSON.stringify(error.response.data, null, 2));
  } else if (error.request) {
    console.error('Não houve resposta do servidor');
    console.error('Código:', error.code);
  }
  process.exit(1);
});





