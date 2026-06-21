const { spawn } = require('node:child_process');

const devServerUrl = process.env.VITE_DEV_SERVER_URL
  ? String(process.env.VITE_DEV_SERVER_URL).trim()
  : 'http://localhost:4200';

const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: devServerUrl,
  NODE_ENV: process.env.NODE_ENV || 'development'
};

console.log('ELECTRON SERVE: devServerUrl=', devServerUrl);
console.log('ELECTRON SERVE: waiting for dev server at', devServerUrl);

const waitOn = spawn('npx', ['wait-on', devServerUrl], {
  shell: true,
  stdio: 'inherit',
  env
});

waitOn.on('exit', (code) => {
  if (code !== 0) {
    console.error('ELECTRON SERVE: wait-on failed with code', code);
    process.exit(code);
    return;
  }

  console.log('ELECTRON SERVE: starting electron');
  const electron = spawn('npx', ['electron', '.'], {
    shell: true,
    stdio: 'inherit',
    env
  });

  electron.on('exit', (exitCode) => {
    process.exit(exitCode ?? 0);
  });
});

waitOn.on('error', (err) => {
  console.error('ELECTRON SERVE: failed to launch wait-on', err);
  process.exit(1);
});
