const http = require("http");
const https = require("https");
const { URL } = require("url");

// ── CONFIG ──────────────────────────────────────────────
// Fill these in from your Discord Developer Portal application:
//   https://discord.com/developers/applications
const CONFIG = {
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  redirectUri: process.env.DISCORD_REDIRECT_URI,
  guildId: process.env.DISCORD_GUILD_ID,
  targetOrigin: process.env.TARGET_ORIGIN || "*",
};

// ── OAuth callback handler ──────────────────────────────
async function handleCallback(url, res) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) return sendHtml(res, 400, `<script>alert("No auth code received.");window.close()</script>`);

  try {
    // 1. Exchange the code for an access token
    const token = await exchangeCode(code);

    // 2. Fetch user info
    const user = await fetchDiscord("/api/users/@me", token.access_token);

    // 3. Check guild membership
    const guilds = await fetchDiscord("/api/users/@me/guilds", token.access_token);
    const inGuild = guilds.some((g) => g.id === CONFIG.guildId);

    // 4. Build result
    const tag = user.discriminator && user.discriminator !== "0" ? `#${user.discriminator}` : "";
    const result = {
      username: `${user.global_name || user.username}${tag}`,
      id: user.id,
      inGuild,
    };

    // 5. Return HTML that posts back to opener and closes
    const origin = escapeHtml(CONFIG.targetOrigin || "*");
    const data = escapeHtml(JSON.stringify(result));
    const html = `<!DOCTYPE html><html><body><script>
      window.opener.postMessage({type:"discordAuth",data:${data}},"${origin}");
      window.close();
    <\/script></body></html>`;
    sendHtml(res, 200, html);
  } catch (err) {
    sendHtml(res, 400, `<script>alert("Error: ${escapeHtml(err.message)}");window.close()</script>`);
  }
}

// ── Discord token exchange ──────────────────────────────
function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: CONFIG.redirectUri,
    }).toString();

    const req = https.request(
      {
        hostname: "discord.com",
        path: "/api/oauth2/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error_description || parsed.error));
            resolve(parsed);
          } catch {
            reject(new Error("Token exchange failed"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Generic Discord API fetch ───────────────────────────
function fetchDiscord(path, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "discord.com",
        path,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Failed to parse ${path}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ── Helpers ─────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html" });
  res.end(html);
}

// ── Server ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/discord-callback") {
    handleCallback(url, res);
  } else {
    sendHtml(res, 404, "Not found");
  }
});

server.listen(3000, () => {
  console.log("Discord OAuth server running on http://localhost:3000");
  console.log("Set env vars: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, DISCORD_GUILD_ID");
});
