// Cloudflare Worker — Discord OAuth callback
// Deploy via Cloudflare Dashboard (NOT connected to GitHub Pages)
//
export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/discord-callback") {
      return handleCallback(url);
    }

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleCallback(url) {
  const code = url.searchParams.get("code");
  if (!code) {
    return new Response('<script>alert("No auth code.");window.close()</script>', {
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    // 1. Exchange code for token
    const token = await exchangeCode(code);

    // 2. Fetch user info
    const user = await fetchDiscord("/api/users/@me", token.access_token);

    // 3. Check guild membership
    const guilds = await fetchDiscord("/api/users/@me/guilds", token.access_token);
    const inGuild = Array.isArray(guilds) && guilds.some((g) => g.id === "1405710246655164557");

    // 4. Build result
    const result = {
      username: user.username,
      displayName: user.global_name || user.username,
      id: user.id,
      inGuild,
    };

    // 5. Return HTML that posts to opener and closes
    const html = `<!DOCTYPE html><html><body><script>
      window.opener.postMessage({type:"discordAuth",data:${JSON.stringify(
        result
      )}},"*");
      window.close();
    <\/script></body></html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  } catch (err) {
    return new Response(
      `<script>alert("Error: ${err.message.replace(/"/g, "&quot;")}");window.close()</script>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: "1518260560766963912",
    client_secret: "yz81Eo6wBiRDNMYhxdZ53pvk2Ifu_ozH",
    grant_type: "authorization_code",
    code: code,
    redirect_uri: "https://discord-auth-worker.arianthonyungsod.workers.dev/discord-callback",
  });

  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "STR.BossTracker/1.0",
    },
    body,
  });

  let data;
  try { data = await res.json(); } catch { data = await res.text(); }
  if (!res.ok)
    throw new Error(`Token exchange HTTP ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

async function fetchDiscord(path, accessToken) {
  const url = `https://discord.com${path.replace("@", "%40")}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "STR.BossTracker/1.0",
    },
  });
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch { data = body; }
  if (!res.ok)
    throw new Error(`Discord ${path} HTTP ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}
