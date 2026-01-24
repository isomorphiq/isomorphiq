import { createConnection, type Socket } from "node:net";
import { fileURLToPath } from "node:url";

const HOST = "localhost";
const PORT = 3001;

export function sendCommand(command: string, data: Record<string, unknown> = {}) {
    return new Promise((resolve, reject) => {
        const client = createConnection({ host: HOST, port: PORT }, () => {
            const message = `${JSON.stringify({ command, data })}\n`;
            client.write(message);
        });

        let response = "";
        client.on("data", (chunk) => {
            response += chunk.toString();
            if (response.endsWith("\n")) {
                client.end();
                try {
                    const result = JSON.parse(response.trim());
                    resolve(result);
                } catch {
                    reject(new Error("Invalid response from server"));
                }
            }
        });

        client.on("error", (err) => {
            reject(err);
        });
    });
}

export function createDaemonConnection(
    options: { host?: string; port?: number } | (() => void) = {},
    listener?: () => void,
): Socket {
    const normalized =
        typeof options === "function"
            ? { host: HOST, port: PORT }
            : { host: options.host ?? HOST, port: options.port ?? PORT };
    const connectionListener = typeof options === "function" ? options : listener;
    return createConnection(
        {
            host: normalized.host,
            port: normalized.port,
        },
        connectionListener,
    );
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
    const args = argv;
    if (args.length === 0) {
        console.log("Usage: node cli-client.ts <command> [args...]");
        console.log("Commands:");
        console.log("  create_task <title> <description> [priority]");
        console.log("  list_tasks");
        console.log("  get_task <id>");
        console.log("  update_task_status <id> <status>");
        console.log("  update_task_priority <id> <priority>");
        console.log("  delete_task <id>");
        console.log("  restart");
        return;
    }

    const command = args[0];

    try {
        let result: unknown;
        switch (command) {
            case "create_task": {
                if (args.length < 3) {
                    throw new Error("create_task requires title and description");
                }
                const title = args[1];
                const description = args[2];
                const priority = args[3] || "medium";
                result = await sendCommand("create_task", { title, description, priority });
                break;
            }
            case "list_tasks":
                result = await sendCommand("list_tasks");
                break;
            case "get_task":
                if (args.length < 2) {
                    throw new Error("get_task requires id");
                }
                result = await sendCommand("get_task", { id: args[1] });
                break;
            case "update_task_status": {
                if (args.length < 3) {
                    throw new Error("update_task_status requires id and status");
                }
                const validStatuses = ["todo", "in-progress", "done", "failed"];
                if (args[2] === undefined || !validStatuses.includes(args[2])) {
                    throw new Error("Invalid status. Must be one of: todo, in-progress, done, failed");
                }
                result = await sendCommand("update_task_status", {
                    id: args[1],
                    status: args[2] as string,
                });
                break;
            }
            case "update_task_priority":
                if (args.length < 3) {
                    throw new Error("update_task_priority requires id and priority");
                }
                result = await sendCommand("update_task_priority", { id: args[1], priority: args[2] });
                break;
            case "delete_task":
                if (args.length < 2) {
                    throw new Error("delete_task requires id");
                }
                result = await sendCommand("delete_task", { id: args[1] });
                break;
            case "restart":
                result = await sendCommand("restart");
                break;
            default:
                throw new Error(`Unknown command: ${command}`);
        }

        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exitCode = 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error("CLI error:", error);
        process.exit(1);
    });
}
