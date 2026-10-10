#!/usr/bin/env node
'use strict';
/*
 * Run the companion without Electron:  node src/server/standalone.js [--sim demo|xplane|msfs|auto] [--lan] [--port 8155]
 * Then open http://127.0.0.1:8155 in any browser.
 */
const os = require('os');
const path = require('path');
const { PipServer } = require('./server');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const overrides = {};
if (opt('sim')) overrides.sim = opt('sim');
if (opt('port')) overrides.port = Number(opt('port'));
if (opt('speed')) overrides.demoSpeed = Number(opt('speed'));
if (args.includes('--lan')) overrides.lanAccess = true;

const dataDir = opt('data') || path.join(os.homedir(), '.pip-pilot-3000');
const server = new PipServer({ dataDir, overrides });
server.start().then((url) => {
  console.log(`PIP-PILOT 3000 ready at ${url}  (data: ${dataDir})`);
});
const shutdown = () => server.stop().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
