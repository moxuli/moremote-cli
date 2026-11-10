#!/usr/bin/env node
import('../dist/cli.js').catch(()=>{console.error('MoRemote CLI could not start. Run npm run build with Node 24.13+.');process.exitCode=1;});
