import { createConnection } from 'net';

const HOST = 'localhost';
const PORT = 3001;

function sendCommand(command: string, data: any = {}) {
  return new Promise((resolve, reject) => {
    const client = createConnection({ host: HOST, port: PORT }, () => {
      const message = JSON.stringify({ command, data }) + '\n';
      client.write(message);
    });

    let response = '';
    client.on('data', (chunk) => {
      response += chunk.toString();
      if (response.endsWith('\n')) {
        client.end(); // Close the connection
        try {
          const result = JSON.parse(response.trim());
          resolve(result);
        } catch (err) {
          reject(new Error('Invalid response from server'));
        }
      }
    });

    client.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node cli-client.ts <command> [args...]');
    console.log('Commands:');
    console.log('  create_task <title> <description> [priority]');
    console.log('  list_tasks');
    console.log('  get_task <id>');
    console.log('  update_task_status <id> <status>');
    console.log('  update_task_priority <id> <priority>');
    console.log('  delete_task <id>');
    console.log('  restart');
    process.exit(1);
  }

  const command = args[0];

  try {
    let result;
    switch (command) {
      case 'create_task':
        if (args.length < 3) {
          console.error('create_task requires title and description');
          process.exit(1);
        }
        const title = args[1];
        const description = args[2];
        const priority = args[3] || 'medium';
        result = await sendCommand('create_task', { title, description, priority });
        break;
      case 'list_tasks':
        result = await sendCommand('list_tasks');
        break;
      case 'get_task':
        if (args.length < 2) {
          console.error('get_task requires id');
          process.exit(1);
        }
        result = await sendCommand('get_task', { id: args[1] });
        break;
      case 'update_task_status':
        if (args.length < 3) {
          console.error('update_task_status requires id and status');
          process.exit(1);
        }
        const validStatuses = ['todo', 'in-progress', 'done', 'failed'];
        if (!validStatuses.includes(args[2]!)) {
          console.error('Invalid status. Must be one of: todo, in-progress, done, failed');
          process.exit(1);
        }
        result = await sendCommand('update_task_status', { id: args[1], status: args[2]! });
        break;
      case 'update_task_priority':
        if (args.length < 3) {
          console.error('update_task_priority requires id and priority');
          process.exit(1);
        }
        result = await sendCommand('update_task_priority', { id: args[1], priority: args[2] });
        break;
      case 'delete_task':
        if (args.length < 2) {
          console.error('delete_task requires id');
          process.exit(1);
        }
        result = await sendCommand('delete_task', { id: args[1] });
        break;
      case 'restart':
        result = await sendCommand('restart');
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

main();