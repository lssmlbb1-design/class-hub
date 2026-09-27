export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    try {
      // Ваша ссылка на Google Apps Script (/exec)
      const GAS_URL = "https://script.google.com/macros/s/AKfycbwAB7u0yqcXRQ09x7EXRxeMTsEzIVlqBvbBn_beXQHvJHFxl-rB0TqkkHiMJ3xy6EGcMQ/exec";

      const body = await request.text();

      // Фоновая пересылка в Google Apps Script
      ctx.waitUntil(
        fetch(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body
        })
      );

      // Мгновенный 200 OK для Telegram
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
