

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
      const message = String(data.message || "").trim().slice(0, 500);

      if (!name || !phone) {
        return Response.json(
          { success: false, error: "Name and phone are required" },
          { status: 400 }
        );
      }

      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return Response.json(
          { success: false, error: "Telegram is not configured" },
          { status: 500 }
        );
      }

      const text = [
        "🥊 TOKTAR FIGHT CLUB — Жаңа өтінім",
        `👤 Аты: ${name}`,
        `📞 Телефон: ${phone}`,
        `🥋 Бағыты: ${sport || "Көрсетілмеген"}`,
        `💬 Хабарлама: ${message || "Жоқ"}`
      ].join("\n");

      try {
        const response = await fetch(
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

        if (!response.ok) {
          return Response.json(
            { success: false, error: "Telegram delivery failed" },
            { status: 502 }
          );
        }

        return Response.json({ success: true });
      } catch {
        return Response.json(
          { success: false, error: "Telegram connection failed" },
          { status: 502 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
