export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const errParam = url.searchParams.get('error');

    if (errParam) {
      return redirect({ error: 'Authorization was denied.' });
    }
    if (!code) {
      return redirect({ error: 'No authorization code provided.' });
    }

    const REDIRECT_URI = url.origin;

    try {
      const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        console.error('Token exchange failed:', errText);
        return redirect({ error: 'Authentication failed.' });
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

      return redirect({
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
      return redirect({ error: 'Authentication failed. Please try again.' });
    }
  },
};

function redirect(data) {
  const encoded = btoa(JSON.stringify(data));
  return Response.redirect(
    `https://momowzen.github.io/STR.BossTracker/#discordAuth=${encoded}`,
    302
  );
}
