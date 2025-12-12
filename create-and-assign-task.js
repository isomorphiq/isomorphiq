import http from 'http';

function claimHighestPriorityTask() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3003,
      path: '/api/queue',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log('📋 Task queue response:', result);
          
          if (result.nextTask) {
            console.log('🎯 Highest priority task found:', result.nextTask.title);
            console.log('🔥 Priority:', result.nextTask.priority);
            console.log('📊 Status:', result.nextTask.status);
            console.log('🆔 Task ID:', result.nextTask.id);
            resolve(result.nextTask);
          } else {
            console.log('❌ No available tasks in queue');
            resolve(null);
          }
        } catch (err) {
          console.log('Raw response:', data);
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error getting task queue:', err.message);
      reject(err);
    });

    req.end();
  });
}

claimHighestPriorityTask().catch(console.error);