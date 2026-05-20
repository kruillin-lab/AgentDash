'use strict';

/**
 * Run once as Administrator to register AgentDash as a Windows startup service.
 * Usage:
 *   node install-service.js          -- install
 *   node install-service.js remove   -- uninstall
 */

const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'AgentDash - Agent Launcher Dashboard',
  description: 'AgentDash: serves localhost:3000. Restart if dashboard is unreachable.',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [],
  env: [
    { name: 'PORT', value: '3000' },
    { name: 'NODE_ENV', value: 'production' },
  ],
});

if (process.argv[2] === 'remove') {
  svc.on('uninstall', () => {
    console.log('AgentDash service removed.');
  });
  svc.uninstall();
} else {
  svc.on('install', () => {
    console.log('AgentDash service installed and started.');
    console.log('It will auto-start on every login.');
    console.log('Dashboard: http://localhost:3000');
    svc.start();
  });

  svc.on('alreadyinstalled', () => {
    console.log('Already installed. Run with "remove" first to reinstall.');
  });

  svc.on('error', (err) => {
    console.error('Service error:', err);
  });

  svc.install();
}
