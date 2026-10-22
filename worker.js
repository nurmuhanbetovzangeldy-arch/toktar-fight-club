
const COOKIE_NAME = "admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64url(new Uint8Array(signature));
}

async function makeSession(secret) {
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })
    )
  );

  return `${payload}.${await sign(payload, secret)}`;
}

async function validSession(request, secret) {
  if (!secret) return false;

  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
  if (!match) return false;

  const parts = match[1].split(".");
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  if (signature !== await sign(payload, secret)) return false;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(atob(normalized));
    return Number(data.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function preparePrices(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS prices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT DEFAULT ''
    )
  `).run();

  const defaults = [
    { id: "boxing", name: "Бокс", amount: 25000, description: "Айлық абонемент" },
    { id: "mma", name: "MMA", amount: 25000, description: "Айлық абонемент" },
    { id: "grappling", name: "Грэпплинг", amount: 20000, description: "Айлық абонемент" }
  ];

  for (const item of defaults) {
    await db.prepare(`
      INSERT OR IGNORE INTO prices (id, name, amount, description)
      VALUES (?, ?, ?, ?)
    `).bind(item.id, item.name, item.amount, item.description).run();
  }
}

async function getPrices(db) {
  await preparePrices(db);
  const result = await db.prepare(
    "SELECT id, name, amount, description FROM prices ORDER BY id"
  ).all();

  return result.results || [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Бағалар тізімін көру
    if (path === "/api/prices" && request.method === "GET") {
      try {
        if (!env.DB) {
          return json({ success: false, error: "DB байланысы жоқ" }, 500);
        }
        return json({ success: true, prices: await getPrices(env.DB) });
      } catch {
        return json({ success: false, error: "Бағаларды жүктеу қатесі" }, 500);
      }
    }

    // Әкімшіге кіру
    if (path === "/api/admin/login" && request.method === "POST") {
      if (!env.ADMIN_PASSWORD) {
        return json({ success: false, error: "ADMIN_PASSWORD бапталмаған" }, 500);
      }

      let data;
      try {
        data = await request.json();
      } catch {
        return json({ success: false, error: "Қате сұрау" }, 400);
      }

      if (
        typeof data.password !== "string" ||
        data.password !== env.ADMIN_PASSWORD
      ) {
        return json({ success: false, error: "Құпиясөз қате" }, 401);
      }

      const session = await makeSession(env.ADMIN_PASSWORD);

      return json(
        { success: true },
        200,
        {
          "Set-Cookie": `${COOKIE_NAME}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${SESSION_SECONDS}`,
          "Cache-Control": "no-store"
        }
      );
    }

    // Әкімші сессиясын тексеру
    if (path === "/api/admin/session" && request.method === "GET") {
      const authorized = await validSession(request, env.ADMIN_PASSWORD);
      return json({ success: authorized }, authorized ? 200 : 401, {
        "Cache-Control": "no-store"
      });
    }

    // Әкімшіден шығу
    if (path === "/api/admin/logout" && request.method === "POST") {
      return json(
        { success: true },
        200,
        {
          "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0`
        }
      );
    }

    // Әкімші бағаларды өзгерте алады
    if (path === "/api/admin/prices" && request.method === "POST") {
      if (!(await validSession(request, env.ADMIN_PASSWORD))) {
        return json({ success: false, error: "Алдымен әкімшіге кіріңіз" }, 401);
      }

      if (!env.DB) {
        return json({ success: false, error: "DB байланысы жоқ" }, 500);
      }

      let data;
      try {
        data = await request.json();
      } catch {
        return json({ success: false, error: "Қате сұрау" }, 400);
      }

      if (!Array.isArray(data.prices) || data.prices.length > 20) {
        return json({ success: false, error: "Бағалар тізімі қате" }, 400);
      }

      for (const item of data.prices) {
        if (
          !item ||
          !["boxing", "mma", "grappling"].includes(item.id) ||
          typeof item.name !== "string" ||
          item.name.trim().length < 1 ||
          item.name.length > 100 ||
          !Number.isSafeInteger(item.amount) ||
          item.amount < 0 ||
          item.amount > 100000000 ||
          typeof (item.description ?? "") !== "string" ||
          (item.description ?? "").length > 300
        ) {
          return json({ success: false, error: "Баға деректері қате" }, 400);
        }
      }

      try {
        await preparePrices(env.DB);

        for (const item of data.prices) {
          await env.DB.prepare(`
            INSERT INTO prices (id, name, amount, description)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              amount = excluded.amount,
              description = excluded.description
          `).bind(
            item.id,
            item.name.trim(),
            item.amount,
            item.description ?? ""
          ).run();
        }

        return json({ success: true, prices: await getPrices(env.DB) });
      } catch {
        return json({ success: false, error: "Бағаны сақтау қатесі" }, 500);
      }
    }

    // Бұрынғы Telegram өтінім жіберу қызметі
    if (path === "/api/lead") {
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
        return json({ success: false, error: "Invalid request" }, 400);
      }

      const name = String(data.name || "").trim().slice(0, 100);
      const phone = String(data.phone || "").trim().slice(0, 40);
      const sport = String(data.sport || "").trim().slice(0, 100);
      const age = String(data.age || "").trim().slice(0, 3);
      const message = String(data.message || "").trim().slice(0, 500);

      if (!name || !phone) {
        return json(
          { success: false, error: "Аты-жөні мен телефон қажет" },
          400
        );
      }

      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return json(
          { success: false, error: "Telegram баптауы толық емес" },
          500
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
        const response = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
          }
        );

        if (!response.ok) {
          return json(
            { success: false, error: "Telegram хабарламаны қабылдамады" },
            502
          );
        }

        return json({ success: true });
      } catch {
        return json(
          { success: false, error: "Telegram байланысында қате" },
          502
        );
      }
    }

    // Сайттың файлдарын көрсету
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "Сайт файлдарына ASSETS байланысы қосылмаған. Worker Assets баптауын тексеріңіз.",
      { status: 500 }
    );
  }
};
