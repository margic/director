const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');
require('dotenv').config();

const args = [
  '.',
  '--no-sandbox',
  '--disable-gpu',
  '--in-process-gpu',           // Avoid GPU process crash loop in containers
  '--disable-software-rasterizer',
];

const child = spawn(electron, args, {
  stdio: ['inherit', 'inherit', 'pipe'],
  env: process.env
});

child.stderr.on('data', (data) => {
  const output = data.toString();
  // Filter out known harmless Chromium noise in dev containers / headless environments
  if (output.includes('ERROR:dbus') || 
      output.includes('Failed to connect to the bus') ||
      output.includes('Autofill.enable') ||
      output.includes('Autofill.setAddresses') || 
      output.includes('object_path= /org/freedesktop/DBus') ||
      output.includes('GPU process') ||
      output.includes('zygote_communication_linux') ||
      output.includes('network_service_instance') ||
      output.includes('renderer.bundle.js script failed to run') ||
      output.includes('node:electron/js2c/renderer_init')) {
    return;
  }
  process.stderr.write(data);
});

child.on('close', (code) => {
  process.exit(code);
});
