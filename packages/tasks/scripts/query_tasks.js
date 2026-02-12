import { createConnection } from 'net';

const command = process.argv[2] || 'list_tasks';
const data = process.argv[3] ? JSON.parse(process.argv[3]) : {};

const client = createConnection({ port: 3001, host: 'localhost' }, () => {
  console.log('Connected to daemon');
  const message = JSON.stringify({ command, data }) + '\n';
  client.write(message);
});

let response = '';
client.on('data', (data) => {
  response += data.toString();
  try {
    const result = JSON.parse(response.trim());
    console.log('Received:', JSON.stringify(result, null, 2));
    client.end();
  } catch (e) {
    // Wait for more data
  }
});

client.on('error', (err) => {
  console.error('Error:', err.message);
});

client.on('close', () => {
  console.log('Connection closed');
});