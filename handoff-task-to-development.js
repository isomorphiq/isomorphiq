import http from 'http';

async function createAdminUser() {
  console.log("[SETUP] Creating admin user...");
  
  try {
    const response = await makeRequest('/api/auth/register', 'POST', {
      username: 'admin',
      email: 'admin@opencode.local',
      password: 'admin123456',
      role: 'admin',
      profile: {
        firstName: 'System',
        lastName: 'Administrator'
      }
    });

    if (response.status === 201) {
      console.log("[SETUP] ✅ Admin user created successfully");
      return true;
    } else if (response.status === 403) {
      console.log("[SETUP] ℹ️ Registration disabled - admin user likely exists");
      return true;
    } else {
      console.error("[SETUP] ❌ Failed to create admin user:", response.data);
      return false;
    }
  } catch (error) {
    console.error("[SETUP] ❌ Error creating admin user:", error.message);
    return false;
  }
}

async function makeRequest(path, method = 'GET', data = null, token = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    
    const options = {
      hostname: 'localhost',
      port: 3003,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...(postData && { 'Content-Length': Buffer.byteLength(postData) })
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch (error) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

async function authenticate() {
  console.log("[AUTH] Attempting to authenticate...");
  
  try {
    const response = await makeRequest('/api/auth/login', 'POST', {
      username: 'admin',
      password: 'admin123456'
    });

    if (response.status === 200 && response.data.token) {
      console.log("[AUTH] ✅ Authentication successful");
      return response.data.token;
    } else {
      console.error("[AUTH] ❌ Authentication failed:", response.data);
      return null;
    }
  } catch (error) {
    console.error("[AUTH] ❌ Authentication error:", error.message);
    return null;
  }
}

async function getAndAssignTask(token) {
  console.log("[TASK] Fetching tasks...");
  
  try {
    const response = await makeRequest('/api/tasks', 'GET', null, token);
    
    if (response.status !== 200 || !response.data.tasks) {
      console.error("[TASK] ❌ Failed to fetch tasks:", response.data);
      return false;
    }

    const tasks = response.data.tasks;
    console.log(`[TASK] Found ${tasks.length} total tasks`);

    // Find highest priority unassigned todo task
    const priorityWeight = { high: 0, medium: 1, low: 2, invalid: 3 };
    const availableTasks = tasks
      .filter(task => task.status === 'todo' && !task.assignedTo)
      .sort((a, b) => {
        const weightA = priorityWeight[a.priority] || 999;
        const weightB = priorityWeight[b.priority] || 999;
        if (weightA !== weightB) {
          return weightA - weightB;
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

    if (availableTasks.length === 0) {
      console.log("[TASK] ℹ️ No available tasks to assign");
      return true;
    }

    const targetTask = availableTasks[0];
    console.log(`[TASK] 🎯 Found highest priority available task:`);
    console.log(`   ID: ${targetTask.id}`);
    console.log(`   Title: ${targetTask.title}`);
    console.log(`   Priority: ${targetTask.priority}`);
    console.log(`   Status: ${targetTask.status}`);

    // Assign to development
    console.log(`[ASSIGN] Assigning task to development...`);
    const assignResponse = await makeRequest(`/api/tasks/${targetTask.id}/assign`, 'PUT', {
      assignedTo: 'development'
    }, token);

    if (assignResponse.status === 200 && assignResponse.data.task) {
      console.log("[ASSIGN] ✅ Task assigned successfully:");
      console.log(`   Title: ${assignResponse.data.task.title}`);
      console.log(`   Assigned to: ${assignResponse.data.task.assignedTo}`);
      console.log("\n🚀 Task successfully handed to development for implementation!");
      return true;
    } else {
      console.error("[ASSIGN] ❌ Failed to assign task:", assignResponse.data);
      return false;
    }

  } catch (error) {
    console.error("[TASK] ❌ Error:", error.message);
    return false;
  }
}

async function main() {
  try {
    // Step 1: Try to create admin user (might already exist)
    await createAdminUser();
    
    // Step 2: Authenticate
    const token = await authenticate();
    if (!token) {
      console.log("❌ Cannot proceed without authentication");
      process.exit(1);
    }

    // Step 3: Get tasks and assign highest priority one
    const success = await getAndAssignTask(token);
    
    if (success) {
      process.exit(0);
    } else {
      process.exit(1);
    }

  } catch (error) {
    console.error("❌ Unexpected error:", error.message);
    process.exit(1);
  }
}

main();