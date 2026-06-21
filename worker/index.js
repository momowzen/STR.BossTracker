export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      return respond({ error: 'Authorization was denied.' });
    }
    if (!code) {
      return respond({ error: 'No authorization code provided.' });
    }

    try {
      const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: url.origin + url.pathname,
        }),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        console.error('Token exchange failed:', errText);
        return respond({ error: 'Authentication failed.' });
      }

      const tokenData = await tokenResp.json();
      const accessToken = tokenData.access_token;

      const userResp = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = await userResp.json();

      const guildsResp = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const guilds = await guildsResp.json();

      const guildMember = guilds.some(g => g.id === env.DISCORD_GUILD_ID);

      return respond({
        userId: user.id,
        username: user.username,
        displayName: user.global_name || user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : null,
        guildMember,
      });
    } catch (err) {
      console.error('Worker error:', err.message);
      return respond({ error: 'Authentication failed. Please try again.' });
    }
  },
};

function respond(data) {
  const json = JSON.stringify(data);
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Redirecting...</title></head>
<body>
<script>
try {
  const auth = ${json};
  if (auth.error) {
    localStorage.setItem('discordAuthError', auth.error);
    localStorage.removeItem('discordAuth');
  } else {
    localStorage.setItem('discordAuth', JSON.stringify(auth));
    localStorage.removeItem('discordAuthError');
  }
} catch(e) {}
window.location.href = 'https://momowzen.github.io/STR.BossTracker/';
<\/script>
<noscript>
  <p>JavaScript is required to complete login.</p>
  <p><a href="https://momowzen.github.io/STR.BossTracker/">Return to Boss Tracker</a></p>
</noscript>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
