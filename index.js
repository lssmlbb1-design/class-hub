export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Обработка CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Замените на вашу актуальную ссылку Google Apps Script Web App (/exec)
    const GAS_URL = 'https://script.google.com/macros/s/AKfycbzRn_-2GxMqMAmsxsVVFftk65Eh-exI-OCDSRJcb0z7Ua8pN7NuD0Zeoa9MgK2hf3aGmA/exec';

    if (request.method === 'GET') {
      const response = await fetch(GAS_URL + url.search);
      const data = await response.text();

      return new Response(data, {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Для POST запросов
    const body = await request.text();
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });

    const resData = await response.text();
    return new Response(resData, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
