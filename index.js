export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    try {
      // Новая актуальная ссылка на ваше веб-приложение:
      const GAS_URL = "https://script.google.com/macros/s/AKfycbwMXejYR6g5kbdsNO_AS5MvUvI_OWRG3M9Z486-AiyImYXUCyCtB9zWm245JpCRvKQIkg/exec";

      const body = await request.text();

      ctx.waitUntil(
        fetch(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body
        })
      );

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
