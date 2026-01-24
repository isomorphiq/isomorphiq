import http from 'http';

function createHighPriorityTask() {
  const taskData = JSON.stringify({
    title: "Implement Real-Time Collaboration and WebSocket Integration",
    description: "Add real-time collaboration features including live task updates, team member presence indicators, simultaneous editing capabilities, and instant notifications using WebSocket connections for seamless team coordination.",
    priority: "high",
    type: "task",
    assignedTo: "development",
    dependencies: [],
    tags: ["collaboration", "websocket", "real-time", "team-workflow"]
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3003,
      path: '/api/tasks',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer system-token', // System token for internal operations
        'Content-Length': Buffer.byteLength(taskData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('Raw response:', data);
        try {
          const result = JSON.parse(data);
          console.log('✅ High priority task created successfully!');
          console.log('🚀 Task Title:', result.task?.title || 'Unknown');
          console.log('🔥 Priority:', result.task?.priority || 'Unknown');
          console.log('👥 Assigned to:', result.task?.assignedTo || 'Unknown');
          console.log('📊 Status:', result.task?.status || 'Unknown');
          console.log('🆔 Task ID:', result.task?.id || 'Unknown');
          console.log('📝 Description:', result.task?.description || 'Unknown');
          resolve(result);
        } catch (err) {
          console.log('Failed to parse JSON:', err.message);
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error creating task:', err.message);
      reject(err);
    });

    req.write(taskData);
    req.end();
  });
}

createHighPriorityTask().catch(console.error);