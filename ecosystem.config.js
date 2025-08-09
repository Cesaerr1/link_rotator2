module.exports = {
  apps: [{
    name: 'rotator',
    script: 'src/index.js',
    env: { NODE_ENV: 'production' },
    max_restarts: 10,
    exp_backoff_restart_delay: 200,
    error_file: '~/.pm2/logs/rotator-error.log',
    out_file: '~/.pm2/logs/rotator-out.log'
  }]
};
