
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Сайттағы өтінімді Telegram-ға жіберу
    if (url.pathname === "/api/lead") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "POST" }
        });
      }

      let data;
      try {
        data = await request.json();
      } catch {
        return Response.json(
          { success: false, error: "Invalid request" },
          { status: 400 }
        );
      }

      const name = String(data.name || "").trim().slice(0, 100);
      const phone = String(data.phone || "").trim().slice(0, 40);
      const sport = String(data.sport || "").trim().slice(0, 100);
      const age = String(data.age || "").trim().slice(0, 3);
      const message = String(data.message || "").trim().slice(0, 500);

      if (!name || !phone) {
        return Response.json(
          { success: false, error: "Аты-жөні мен телефон қажет" },
          { status: 400 }
        );
      }

      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return Response.json(
          { success: false, error: "Telegram баптауы толық емес" },
          { status: 500 }
        );
      }

      const text = [
        "🥊 TOKTAR FIGHT CLUB — ЖАҢА ӨТІНІМ",
        "",
        `👤 Аты-жөні: ${name}`,
        `📞 Телефон: ${phone}`,
        `🥋 Спорт түрі: ${sport || "Көрсетілмеген"}`,
        `🎂 Жасы: ${age || "Көрсетілмеген"}`,
        `💬 Қосымша ақпарат: ${message || "Жоқ"}`
      ].join("\n");

      try {
        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              text
            })
          }
        );

        if (!telegramResponse.ok) {
          return Response.json(
            { success: false, error: "Telegram хабарламаны қабылдамады" },
            { status: 502 }
          );
        }

        return Response.json({ success: true });
      } catch {
        return Response.json(
          { success: false, error: "Telegram байланысында қате" },
          { status: 502 }
        );
      }
    }

    // Қалған сайт файлдарын көрсету
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Сайт файлдарына ASSETS байланысы қосылмаған", {
      status: 500
    });
  }
};
