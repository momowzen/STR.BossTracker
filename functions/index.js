const functions = require('firebase-functions');

const PROJECT_ID = 'bosstracker-a290e';
const REGION = 'us-central1';
const FUNCTION_NAME = 'discord-callback';
const FUNCTION_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${FUNCTION_NAME}`;
const REDIRECT_BASE = 'https://momowzen.github.io/STR.BossTracker';

exports.discordCallback = functions.https.onRequest(async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;

  if (error) {
    return redirect(res, { error: 'Authorization was denied.' });
  }
  if (!code) {
    return redirect(res, { error: 'No authorization code provided.' });
  }

  const config = functions.config().discord || {};
  const CLIENT_ID = config.client_id;
  const CLIENT_SECRET = config.client_secret;
  const GUILD_ID = config.guild_id;

  try {
    const axios = require('axios');

    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: FUNCTION_URL,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = userRes.data;

    const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const guildMember = guildsRes.data.some(g => g.id === GUILD_ID);

    redirect(res, {
      userId: user.id,
      username: user.username,
      displayName: user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null,
      guildMember,
    });
  } catch (err) {
    console.error('Discord OAuth error:', err.response?.data || err.message);
    redirect(res, { error: 'Authentication failed. Please try again.' });
  }
});

function redirect(res, data) {
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
  res.redirect(302, `${REDIRECT_BASE}/#discordAuth=${encoded}`);
}
