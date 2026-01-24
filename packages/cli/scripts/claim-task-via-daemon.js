import http from 'http';

function claimHighestPriorityTask() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/claim_highest_priority_task',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '0'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log('Task claimed successfully:', result);
          resolve(result);
        } catch (err) {
          console.log('Raw response:', data);
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error claiming task:', err.message);
      reject(err);
    });

    req.end();
  });
}

claimHighestPriorityTask().catch(console.error);