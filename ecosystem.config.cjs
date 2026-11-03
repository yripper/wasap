// pm2 app definition. Run `pnpm build` first: pm2 runs the compiled CLI.
module.exports = {
  apps: [
    {
      name: 'wasap',
      script: 'dist/cli.js',
      args: 'start',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // A start that dies within 10s (held lock, bad config) counts against max_restarts.
      min_uptime: '10s',
      // Lets Baileys close the socket and flush creds before pm2 kills the process.
      kill_timeout: 10000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
