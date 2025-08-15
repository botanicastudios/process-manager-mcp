#!/usr/bin/env node
/*
 * Process Manager MCP Server
 *
 * A Model Context Protocol server that provides process management capabilities:
 * - Start processes with configurable auto-shutdown behavior
 * - Stop processes by PID
 * - List running processes for the current working directory
 * - Retrieve process logs with tail functionality
 * - Monitor process health and update status automatically
 * - Persist process information across server restarts
 *
 * The server uses the CWD environment variable to organize processes by directory,
 * allowing multiple instances of the same command to run in different locations.
 */
import { McpServer, ResourceTemplate, } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ProcessManager } from "./process-manager.js";
// Create process manager instance
const processManager = new ProcessManager();
// Create MCP server
const server = new McpServer({
    name: "process-manager-mcp",
    version: "1.0.0",
});
// Register start_process tool
server.registerTool("start_process", {
    title: "Start Process",
    description: "Start a new process with the given command",
    inputSchema: {
        command: z.string().describe("The command to execute"),
        auto_shutdown: z
            .boolean()
            .default(true)
            .describe("Whether to automatically shutdown the process when MCP server stops"),
        cwd: z
            .string()
            .optional()
            .describe(`Working directory for the process. Supports relative paths like './server' or 'server' (relative to ${process.env.CWD || process.cwd()})`),
    },
}, async ({ command, auto_shutdown = true, cwd }) => {
    try {
        const pid = await processManager.startProcess(command, auto_shutdown, cwd);
        if (!pid || pid === undefined) {
            throw new Error("Process started but no PID was returned");
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Process started successfully. PID: ${pid}`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to start process: ${error}`,
                },
            ],
            isError: true,
        };
    }
});
// Register end_process tool
server.registerTool("end_process", {
    title: "End Process",
    description: "Stop a running process by PID",
    inputSchema: {
        pid: z.number().describe("The PID of the process to stop"),
    },
}, async ({ pid }) => {
    try {
        const success = await processManager.endProcess(pid);
        if (success) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Process stopped successfully",
                    },
                ],
            };
        }
        else {
            return {
                content: [
                    {
                        type: "text",
                        text: "Process not found or could not be stopped",
                    },
                ],
                isError: true,
            };
        }
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to stop process: ${error}`,
                },
            ],
            isError: true,
        };
    }
});
// Register get_logs tool
server.registerTool("get_logs", {
    title: "Get Process Logs",
    description: "Fetch logs for a specific process by PID",
    inputSchema: {
        pid: z.number().describe("The PID of the process to get logs for"),
        numLines: z
            .number()
            .optional()
            .default(100)
            .describe("Number of lines to retrieve from the end of the log (defaults to 100)"),
    },
}, async ({ pid, numLines = 100 }) => {
    try {
        const logs = await processManager.getProcessLogs(pid, numLines);
        return {
            content: [
                {
                    type: "text",
                    text: logs,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to retrieve logs: ${error}`,
                },
            ],
            isError: true,
        };
    }
});
// Register list_processes tool
server.registerTool("list_processes", {
    title: "List Processes",
    description: "List all running processes for the current working directory",
    inputSchema: {},
}, async () => {
    try {
        const processes = processManager["getCurrentCwdProcesses"]();
        const processList = Object.entries(processes).map(([key, data]) => ({
            pid: data.pid,
            command: data.command,
            status: data.status,
            startTime: new Date(data.startTime).toISOString(),
            autoShutdown: data.autoShutdown,
            cwd: data.cwd,
            errorOutput: data.errorOutput,
        }));
        // Format as readable text
        if (processList.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No processes are currently running.",
                    },
                ],
            };
        }
        const formattedList = processList
            .map((p) => `PID: ${p.pid}\n` +
            `Command: ${p.command}\n` +
            `Status: ${p.status}\n` +
            `Started: ${p.startTime}\n` +
            `Auto-shutdown: ${p.autoShutdown}\n` +
            `Working Directory: ${p.cwd}` +
            (p.errorOutput ? `\nError: ${p.errorOutput}` : ""))
            .join("\n\n");
        return {
            content: [
                {
                    type: "text",
                    text: formattedList,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Failed to list processes: ${error}`,
                },
            ],
            isError: true,
        };
    }
});
// Register processes resource
server.registerResource("processes", "processes://processes", {
    title: "Running Processes",
    description: "List of running processes for the current working directory",
}, async (uri) => {
    const processes = processManager["getCurrentCwdProcesses"]();
    const processList = Object.entries(processes).map(([key, data]) => ({
        key,
        pid: data.pid,
        command: data.command,
        status: data.status,
        startTime: new Date(data.startTime).toISOString(),
        autoShutdown: data.autoShutdown,
        errorOutput: data.errorOutput,
        pwd: data.cwd,
    }));
    return {
        contents: [
            {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify(processList, null, 2),
            },
        ],
    };
});
// Register logs resource
server.registerResource("logs", new ResourceTemplate("processes://processes/{pid}/logs", {
    list: undefined,
}), {
    title: "Process Logs",
    description: 'Retrieve logs for a specific process. Retrieve the PID using "processes://processes". Optional query parameter: ?numLines=<number> (defaults to 100).',
}, async (uri, { pid }) => {
    try {
        // Parse query parameters from the URI
        const url = new URL(uri.href);
        const numLines = url.searchParams.get('numLines');
        const logs = await processManager.getProcessLogs(Number(pid), Number(numLines) || 100);
        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType: "text/plain",
                    text: logs,
                },
            ],
        };
    }
    catch (error) {
        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType: "text/plain",
                    text: `Error retrieving logs: ${error}`,
                },
            ],
        };
    }
});
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map