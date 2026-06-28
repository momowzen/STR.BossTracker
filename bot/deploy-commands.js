const { REST, Routes } = require('discord.js');

const commands = [
  {
    name: 'nextboss',
    description: 'Show the next boss respawning soonest',
  },
  {
    name: 'schedule',
    description: 'Show today\'s and tomorrow\'s spawn schedule',
  },
];

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('Slash commands registered successfully!');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();
