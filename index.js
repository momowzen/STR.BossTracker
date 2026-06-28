try {
  require.resolve('discord.js');
} catch (e) {
  const { execSync } = require('child_process');
  console.log('Installing dependencies...');
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });
  console.log('Dependencies installed. Restarting...');
  process.exit(0);
}

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { db } = require('./firebase');
const BOSSES = require('./data/bosses.json');
const LOCATIONS = require('./data/locations.json');

const TIME_ZONE = 'Asia/Tokyo';
const TIME_ZONE_OFFSET_MS = 9 * 60 * 60 * 1000;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'nextboss') {
    await handleNextBoss(interaction);
  } else if (interaction.commandName === 'schedule') {
    await handleSchedule(interaction);
  }
});

async function handleNextBoss(interaction) {
  await interaction.deferReply();

  const timersSnap = await db.doc('timers/global').get();
  const timers = timersSnap.exists ? (timersSnap.data().timers || {}) : {};
  const now = Date.now();

  const upcoming = [];

  Object.entries(timers).forEach(([id, info]) => {
    const boss = BOSSES.find((b) => b.id === id);
    if (boss && !boss.isWorldBoss && info.endTime) {
      upcoming.push({ id, endTime: info.endTime, boss });
    }
  });

  BOSSES.forEach((boss) => {
    if (!timers[boss.id] && boss.weeklyRespawns && !boss.isWorldBoss) {
      const next = getNextWeeklyRespawnTime(boss);
      if (next) upcoming.push({ id: boss.id, endTime: next, boss });
    }
  });

  upcoming.sort((a, b) => a.endTime - b.endTime);

  if (!upcoming.length) {
    return interaction.editReply('No upcoming boss respawns found.');
  }

  const soon = upcoming[0];
  const remainingMs = Math.max(0, soon.endTime - now);

  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle(`Next Boss: ${soon.boss.name}`)
    .setThumbnail(`https://raw.githubusercontent.com/momowzen/DFck.LordnineSpawnTracker/refs/heads/main/assets/images/${soon.id}.png`)
    .addFields(
      { name: 'Level', value: `${soon.boss.level}`, inline: true },
      { name: 'Respawn In', value: formatSec(Math.floor(remainingMs / 1000)), inline: true },
      { name: 'Spawn Time', value: formatTimeOnly(soon.endTime), inline: true },
      { name: 'Location', value: LOCATIONS[soon.id] || 'Unknown', inline: false },
    )
    .setFooter({ text: 'STR4NG3RZ Command Center' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handleSchedule(interaction) {
  await interaction.deferReply();

  const timersSnap = await db.doc('timers/global').get();
  const timers = timersSnap.exists ? (timersSnap.data().timers || {}) : {};
  const now = Date.now();

  const embeds = [];

  for (let day = 0; day <= 1; day++) {
    const start = getJSTStartOfDay(day);
    const end = getJSTEndOfDay(day);

    const spawns = [];
    for (const boss of BOSSES) {
      if (boss.isWorldBoss) continue;
      const bossSpawns = getSpawnsInRange(boss, start, end, now, timers);
      spawns.push(...bossSpawns);
    }

    const filtered = spawns.filter((s) => s.time > now + 60000);
    filtered.sort((a, b) => a.time - b.time);

    const dayLabel = day === 0 ? 'TODAY' : 'TOMORROW';
    const color = day === 0 ? 0x2ECC71 : 0xE74C3C;

    if (filtered.length === 0) {
      embeds.push(
        new EmbedBuilder()
          .setColor(color)
          .setTitle(`${dayLabel}`)
          .setDescription('No spawns')
      );
    } else {
      const lines = filtered.map((s) => {
        const timeStr = formatTimeOnly(s.time);
        const loc = LOCATIONS[s.boss.id] || '';
        return `**${s.boss.name}** — ${timeStr}${loc ? ` (${loc})` : ''}`;
      });
      embeds.push(
        new EmbedBuilder()
          .setColor(color)
          .setTitle(`${dayLabel} — ${filtered.length} spawns`)
          .setDescription(lines.join('\n'))
      );
    }
  }

  return interaction.editReply({ embeds });
}

function getNextWeeklyRespawn(respawns, fromTime = Date.now()) {
  const base = new Date(fromTime + TIME_ZONE_OFFSET_MS);
  let soonest = null;
  for (const { day, hour, minute } of respawns) {
    const candidate = new Date(base);
    const delta = (day + 7 - base.getUTCDay()) % 7;
    candidate.setUTCDate(base.getUTCDate() + delta);
    candidate.setUTCHours(hour, minute, 0, 0);
    const candidateUtc = candidate.getTime() - TIME_ZONE_OFFSET_MS;
    if (candidateUtc < fromTime) {
      candidate.setUTCDate(candidate.getUTCDate() + 7);
    }
    const adjustedUtc = candidate.getTime() - TIME_ZONE_OFFSET_MS;
    if (!soonest || adjustedUtc < soonest) soonest = adjustedUtc;
  }
  return soonest;
}

function getNextWeeklyRespawnTime(boss) {
  if (!boss.weeklyRespawns || boss.weeklyRespawns.length === 0) return null;
  return getNextWeeklyRespawn(boss.weeklyRespawns);
}

function getJSTStartOfDay(daysFromNow = 0) {
  const jstNow = new Date(Date.now() + TIME_ZONE_OFFSET_MS);
  const day = new Date(jstNow);
  day.setUTCDate(day.getUTCDate() + daysFromNow);
  day.setUTCHours(0, 0, 0, 0);
  return day.getTime() - TIME_ZONE_OFFSET_MS;
}

function getJSTEndOfDay(daysFromNow = 0) {
  const jstNow = new Date(Date.now() + TIME_ZONE_OFFSET_MS);
  const day = new Date(jstNow);
  day.setUTCDate(day.getUTCDate() + daysFromNow);
  day.setUTCHours(23, 59, 59, 999);
  return day.getTime() - TIME_ZONE_OFFSET_MS;
}

function getSpawnsInRange(boss, start, end, now, timers) {
  const spawns = [];
  if (boss.weeklyRespawns) {
    for (let offset = 0; offset <= 14; offset++) {
      const day = new Date(now + TIME_ZONE_OFFSET_MS);
      day.setUTCDate(day.getUTCDate() + offset);
      const dayStart = new Date(day);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setUTCHours(23, 59, 59, 999);
      const dayStartMs = dayStart.getTime() - TIME_ZONE_OFFSET_MS;
      const dayEndMs = dayEnd.getTime() - TIME_ZONE_OFFSET_MS;
      if (dayEndMs < start) continue;
      if (dayStartMs > end) break;
      for (const slot of boss.weeklyRespawns) {
        const slotDate = new Date(day);
        const delta = (slot.day - day.getUTCDay() + 7) % 7;
        slotDate.setUTCDate(slotDate.getUTCDate() + delta);
        slotDate.setUTCHours(slot.hour, slot.minute, 0, 0);
        const ms = slotDate.getTime() - TIME_ZONE_OFFSET_MS;
        if (ms >= start && ms <= end) {
          spawns.push({ boss, time: ms });
        }
      }
    }
  } else {
    const info = timers[boss.id];
    const time = info && info.endTime ? info.endTime : null;
    if (time && time >= start && time <= end) {
      spawns.push({ boss, time });
    }
  }
  return spawns;
}

function formatSec(s) {
  if (s <= 0) return 'Spawned';
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}m`;
}

function formatTimeOnly(ms) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(ms);
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN environment variable is required.');
  process.exit(1);
}

client.login(token);
