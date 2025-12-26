const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');
require('dotenv').config();

const args = ['.', '--no-sandbox', '--disable-gpu'];

const child = spawn(electron, args, {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code);
});
