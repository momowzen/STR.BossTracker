export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return redirect(res, { error: 'Authorization was denied.' });
  }
  if (!code) {
    return redirect(res, { error: 'No authorization code provided.' });
  }

  try {
    const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `https://${req.headers.host}/api/discord-callback`,
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error('Token exchange failed:', errText);
      return redirect(res, { error: 'Authentication failed.' });
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

    const guildMember = guilds.some(g => g.id === process.env.DISCORD_GUILD_ID);

    redirect(res, {
      userId: user.id,
      username: user.username,
      displayName: user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
      guildMember,
    });
  } catch (err) {
    console.error('Function error:', err.message);
    redirect(res, { error: 'Authentication failed. Please try again.' });
  }
}

function redirect(res, data) {
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
  const url = `https://momowzen.github.io/STR.BossTracker/#discordAuth=${encoded}`;
  res.writeHead(302, { Location: url });
  res.end();
}
