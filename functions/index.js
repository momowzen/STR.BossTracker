const functions = require('firebase-functions');
const axios = require('axios');

const config = functions.config().discord || {};
const CLIENT_ID = config.client_id;
const CLIENT_SECRET = config.client_secret;
const GUILD_ID = config.guild_id;

const FUNCTION_URL = 'https://us-central1-bosstracker-a290e.cloudfunctions.net/discord-callback';
const REDIRECT_BASE = 'https://momowzen.github.io/STR.BossTracker';

exports.discordCallback = functions.https.onRequest(async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return sendResult(res, { error: 'Authorization was denied.' });
  }
  if (!code) {
    return sendResult(res, { error: 'No authorization code provided.' });
  }

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
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

    const { id, username, global_name, avatar } = userRes.data;

    const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const guildMember = guildsRes.data.some(g => g.id === GUILD_ID);

    sendResult(res, {
      userId: id,
      username,
      displayName: global_name || username,
      avatar: avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : null,
      guildMember,
    });
  } catch (err) {
    console.error('Discord OAuth error:', err.response?.data || err.message);
    sendResult(res, { error: 'Authentication failed. Please try again.' });
  }
});

function sendResult(res, data) {
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
window.location.href = '${REDIRECT_BASE}/';
<\/script>
<noscript>
  <p>JavaScript is required to complete login.</p>
  <p><a href="${REDIRECT_BASE}/">Return to Boss Tracker</a></p>
</noscript>
</body>
</html>`;
  res.status(200).type('html').send(html);
}
