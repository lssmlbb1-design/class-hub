const GAS_URL = "https://script.google.com/macros/s/AKfycbzRn_-2GxMqMAmsxsVVFftk65Eh-exI-OCDSRJcb0z7Ua8pN7NuD0Zeoa9MgK2hf3aGmA/exec";

export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // Обработка Preflight-запроса браузера
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    // Пробрасываем все GET-параметры (?action=getProjects) в Google Script
    const targetUrl = GAS_URL + url.search;

    let init = {
      method: request.method,
      redirect: "follow"
    };

    if (request.method === "POST") {
      init.body = await request.text();
      init.headers = { "Content-Type": "application/json" };
    }

    try {
      const response = await fetch(targetUrl, init);
      const data = await response.text();

      return new Response(data, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ status: "error", message: err.toString() }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
