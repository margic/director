const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');
require('dotenv').config();

const args = ['.', '--no-sandbox', '--disable-gpu'];

const child = spawn(electron, args, {
  stdio: ['inherit', 'inherit', 'pipe'],
  env: process.env
});

child.stderr.on('data', (data) => {
  const output = data.toString();
  // Filter out known harmless DBus/Chrome noise in dev containers
  if (output.includes('ERROR:dbus') || 
      output.includes('Failed to connect to the bus') ||
      output.includes('Autofill.enable') ||
      output.includes('Autofill.setAddresses') || 
      output.includes('object_path= /org/freedesktop/DBus')) {
    return;
  }
  process.stderr.write(data);
});

child.on('close', (code) => {
  process.exit(code);
});
