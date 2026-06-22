// Cloudflare Worker — Discord OAuth callback
// Deploy via Cloudflare Dashboard (NOT connected to GitHub Pages)
//
// Required environment variables (set in dashboard):
//   CLIENT_ID      = 1518260560766963912
//   CLIENT_SECRET  = yz81Eo6wBiRDNMYhxdZ53pvk2Ifu_ozH
//   GUILD_ID       = 1405710246655164557
//   REDIRECT_URI   = https://discord-auth-worker.arianthonyungsod.workers.dev/discord-callback

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/discord-callback") {
      return handleCallback(url, env);
    }

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleCallback(url, env) {
  const code = url.searchParams.get("code");
  if (!code) {
    return new Response('<script>alert("No auth code.");window.close()</script>', {
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    // 1. Exchange code for token
    const token = await exchangeCode(code, env);

    // 2. Fetch user info
    const user = await fetchDiscord("/api/users/@me", token.access_token);

    // 3. Check guild membership
    const guilds = await fetchDiscord("/api/users/@me/guilds", token.access_token);
    const inGuild = guilds.some((g) => g.id === env.GUILD_ID);

    // 4. Build result
    const tag =
      user.discriminator && user.discriminator !== "0"
        ? `#${user.discriminator}`
        : "";
    const result = {
      username: `${user.global_name || user.username}${tag}`,
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

async function exchangeCode(code, env) {
  const body = new URLSearchParams({
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.REDIRECT_URI,
  });

  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();
  if (data.error || !res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  return data;
}

async function fetchDiscord(path, accessToken) {
  const res = await fetch(`https://discord.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error || !res.ok) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  return data;
}
