#!/usr/bin/env node

// Test script for multi-profile task processing system
const net = require('net')

const TCP_PORT = process.env.TCP_PORT || 3001
const TCP_HOST = 'localhost'

function sendCommand(command, data = {}) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: TCP_HOST, port: TCP_PORT })
    
    client.on('connect', () => {
      console.log(`[TEST] Connected to daemon, sending command: ${command}`)
      client.write(JSON.stringify({ command, data }) + '\n')
    })
    
    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString().trim())
        console.log(`[TEST] Response for ${command}:`, JSON.stringify(response, null, 2))
        resolve(response)
      } catch (error) {
        console.error(`[TEST] Error parsing response for ${command}:`, error)
        reject(error)
      }
      client.end()
    })
    
    client.on('error', (error) => {
      console.error(`[TEST] Connection error for ${command}:`, error)
      reject(error)
    })
    
    // Timeout after 10 seconds
    setTimeout(() => {
      client.destroy()
      reject(new Error(`Timeout for command: ${command}`))
    }, 10000)
  })
}

async function runTests() {
  console.log('[TEST] Starting multi-profile system tests...\n')
  
  try {
    // Test 1: Get all profile states
    console.log('[TEST] Test 1: Getting all profile states')
    await sendCommand('get_profile_states')
    console.log('')
    
    // Test 2: Get profiles with states
    console.log('[TEST] Test 2: Getting profiles with states')
    await sendCommand('get_profiles_with_states')
    console.log('')
    
    // Test 3: Get all profile metrics
    console.log('[TEST] Test 3: Getting all profile metrics')
    await sendCommand('get_all_profile_metrics')
    console.log('')
    
    // Test 4: Get specific profile metrics
    console.log('[TEST] Test 4: Getting development profile metrics')
    await sendCommand('get_profile_metrics', { name: 'development' })
    console.log('')
    
    // Test 5: Get profile task queue
    console.log('[TEST] Test 5: Getting development profile queue')
    await sendCommand('get_profile_task_queue', { name: 'development' })
    console.log('')
    
    // Test 6: Update profile status
    console.log('[TEST] Test 6: Disabling product-manager profile')
    await sendCommand('update_profile_status', { name: 'product-manager', isActive: false })
    console.log('')
    
    // Test 7: Get best profile for task
    console.log('[TEST] Test 7: Getting best profile for a coding task')
    await sendCommand('get_best_profile_for_task', { 
      task: { 
        title: 'Implement new feature', 
        description: 'Add user authentication',
        type: 'development'
      } 
    })
    console.log('')
    
    // Test 8: Assign task to profile
    console.log('[TEST] Test 8: Assigning task to development profile')
    await sendCommand('assign_task_to_profile', { 
      profileName: 'development',
      task: {
        title: 'Test task',
        description: 'This is a test task for development profile'
      }
    })
    console.log('')
    
    // Test 9: Re-enable product-manager profile
    console.log('[TEST] Test 9: Re-enabling product-manager profile')
    await sendCommand('update_profile_status', { name: 'product-manager', isActive: true })
    console.log('')
    
    // Test 10: Check updated states
    console.log('[TEST] Test 10: Checking updated profile states')
    await sendCommand('get_profile_states')
    console.log('')
    
    console.log('[TEST] ✅ All tests completed successfully!')
    
  } catch (error) {
    console.error('[TEST] ❌ Test failed:', error.message)
    process.exit(1)
  }
}

// Check if daemon is running
async function checkDaemon() {
  try {
    await sendCommand('list_tasks')
    console.log('[TEST] Daemon is running and accessible')
    return true
  } catch (error) {
    console.error('[TEST] ❌ Daemon is not running or not accessible')
    console.error("[TEST] Please start the daemon with: yarn run daemon")
    process.exit(1)
  }
}

// Main execution
async function main() {
  console.log('[TEST] Multi-Profile Task Processing System Test Suite')
  console.log('[TEST] ================================================\n')
  
  await checkDaemon()
  console.log('')
  await runTests()
  
  console.log('\n[TEST] Test suite completed!')
  console.log('[TEST] You can now check the web dashboard at http://localhost:3003')
  console.log('[TEST] Navigate to the "Profiles" and "Profile Analytics" tabs to see the new features')
}

if (require.main === module) {
  main().catch(console.error)
}
