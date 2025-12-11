#!/usr/bin/env node

import { spawn } from 'node:child_process'


console.log('[TEST-RUNNER] Running tests in development mode...')

// Run TypeScript directly using tsx or ts-node
const testProcess = spawn('node', ['src/test.ts'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env
})

testProcess.on('close', (code) => {
  if (code === 0) {
    console.log('[TEST-RUNNER] ✅ All tests passed')
  } else {
    console.log('[TEST-RUNNER] ❌ Tests failed')
    process.exit(code || 1)
  }
})

testProcess.on('error', (error) => {
  console.error('[TEST-RUNNER] Error running tests:', error)
  process.exit(1)
})