import http from 'http';

async function checkAvailableTasks() {
  try {
    console.log("[QUERY] Checking available tasks for development...");
    
    // Query all tasks
    const client = {
      queryTasks: async () => {
        return new Promise((resolve, reject) => {
          const options = {
            hostname: 'localhost',
            port: 3003,
            path: '/tasks',
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          };

          const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
              data += chunk;
            });
            
            res.on('end', () => {
              try {
                const response = JSON.parse(data);
                resolve(response);
              } catch (error) {
                reject(error);
              }
            });
          });

          req.on('error', (error) => {
            reject(error);
          });

          req.end();
        });
      }
    };
    
    const result = await client.queryTasks();
    
    if (result && result.tasks) {
      console.log(`[QUERY] Found ${result.tasks.length} total tasks`);
      
      // Filter for todo tasks that need implementation
      const todoTasks = result.tasks.filter(task => task.status === 'todo');
      const highPriorityTasks = todoTasks.filter(task => task.priority === 'high');
      const mediumPriorityTasks = todoTasks.filter(task => task.priority === 'medium');
      const lowPriorityTasks = todoTasks.filter(task => task.priority === 'low');
      
      console.log(`[QUERY] Tasks needing implementation: ${todoTasks.length}`);
      console.log(`[QUERY] High priority: ${highPriorityTasks.length}`);
      console.log(`[QUERY] Medium priority: ${mediumPriorityTasks.length}`);
      console.log(`[QUERY] Low priority: ${lowPriorityTasks.length}`);
      
      if (highPriorityTasks.length > 0) {
        console.log("\n[QUERY] 🎯 HIGHEST PRIORITY AVAILABLE TASK:");
        const task = highPriorityTasks[0];
        console.log(`   ID: ${task.id}`);
        console.log(`   Title: ${task.title}`);
        console.log(`   Priority: ${task.priority}`);
        console.log(`   Status: ${task.status}`);
        console.log(`   Created: ${task.createdAt}`);
        if (task.description) {
          console.log(`   Description: ${task.description}`);
        }
      }
    } else {
      console.log("[QUERY] No tasks found or error querying tasks");
    }
  } catch (error) {
    console.error("[QUERY] Error checking tasks:", error.message);
  }
}

checkAvailableTasks();