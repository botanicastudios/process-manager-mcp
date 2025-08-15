#!/usr/bin/env node

/*
 * Process Manager MCP Server and CLI
 *
 * Provides both MCP server and CLI interfaces for process management:
 * 
 * MCP Server mode:
 * - Start processes with configurable auto-shutdown behavior
 * - Stop processes by PID
 * - List running processes for the current working directory
 * - Retrieve process logs with tail functionality
 * - Monitor process health and update status automatically
 * - Persist process information across server restarts
 *
 * CLI mode:
 * - Start processes with optional streaming logs
 * - List all managed processes
 * - Stop processes by PID
 * - View or stream process logs
 * 
 * The server uses the CWD environment variable to organize processes by directory,
 * allowing multiple instances of the same command to run in different locations.
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ProcessManager } from "./process-manager.js";
import { runCLI } from "./cli.js";

// Create process manager instance
const processManager = new ProcessManager();

// Create MCP server
const server = new McpServer({
  name: "process-manager-mcp",
  version: "1.0.0",
});

// Register start_process tool
server.registerTool(
  "start_process",
  {
    title: "Start Process",
    description: "Start a new process with the given command",
    inputSchema: {
      command: z.string().describe("The command to execute"),
      auto_shutdown: z
        .boolean()
        .default(true)
        .describe(
          "Whether to automatically shutdown the process when MCP server stops"
        ),
      cwd: z
        .string()
        .optional()
        .describe(
          `Working directory for the process. Supports relative paths like './server' or 'server' (relative to ${
            process.env.CWD || process.cwd()
          })`
        ),
      env: z
        .record(z.string())
        .optional()
        .describe(
          "Environment variables to set for the process (e.g., { \"USER_ID\": \"12345\", \"USER_TOKEN\": \"abcdef\" })"
        ),
    },
  },
  async ({ command, auto_shutdown = true, cwd, env }) => {
    try {
      const pid = await processManager.startProcess(
        command,
        auto_shutdown,
        cwd,
        env
      );
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
    } catch (error) {
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
  }
);

// Register end_process tool
server.registerTool(
  "end_process",
  {
    title: "End Process",
    description: "Stop a running process by PID",
    inputSchema: {
      pid: z.number().describe("The PID of the process to stop"),
    },
  },
  async ({ pid }) => {
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
      } else {
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
    } catch (error) {
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
  }
);

// Register get_logs tool
server.registerTool(
  "get_logs",
  {
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
  },
  async ({ pid, numLines = 100 }) => {
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
    } catch (error) {
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
  }
);

// Register list_processes tool
server.registerTool(
  "list_processes",
  {
    title: "List Processes",
    description: "List running processes. By default shows processes from current working directory and subdirectories.",
    inputSchema: {
      show_all_processes: z
        .boolean()
        .optional()
        .default(false)
        .describe("Show all processes, not just those started from the current working directory or subdirectories"),
    },
  },
  async ({ show_all_processes = false }) => {
    try {
      let processes: { [key: string]: any };
      
      if (show_all_processes) {
        processes = processManager["getAllProcesses"]();
      } else {
        // Show processes from current directory and subdirectories
        processes = processManager["getAllProcessesInDirectory"](true);
      }
      
      const processList = Object.entries(processes).map(([key, data]: [string, any]) => ({
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
        const message = show_all_processes 
          ? "No processes are currently running."
          : "No processes are currently running in this directory or its subdirectories.";
        return {
          content: [
            {
              type: "text",
              text: message,
            },
          ],
        };
      }

      const formattedList = processList
        .map(
          (p) =>
            `PID: ${p.pid}\n` +
            `Command: ${p.command}\n` +
            `Status: ${p.status}\n` +
            `Started: ${p.startTime}\n` +
            `Auto-shutdown: ${p.autoShutdown}\n` +
            `Working Directory: ${p.cwd}` +
            (p.errorOutput ? `\nError: ${p.errorOutput}` : "")
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: formattedList,
          },
        ],
      };
    } catch (error) {
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
  }
);

// Register processes resource
server.registerResource(
  "processes",
  "processes://processes",
  {
    title: "Running Processes",
    description: "List of running processes for the current working directory and subdirectories",
  },
  async (uri: any) => {
    // Use the new method to get processes from current directory and subdirectories
    const processes = processManager["getAllProcessesInDirectory"](true);
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
  }
);

// Register logs resource
server.registerResource(
  "logs",
  new ResourceTemplate("processes://processes/{pid}/logs", {
    list: undefined,
  }),
  {
    title: "Process Logs",
    description:
      'Retrieve logs for a specific process. Retrieve the PID using "processes://processes". Optional query parameter: ?numLines=<number> (defaults to 100).',
  },
  async (uri: any, { pid }: any) => {
    try {
      // Parse query parameters from the URI
      const url = new URL(uri.href);
      const numLines = url.searchParams.get('numLines');
      
      const logs = await processManager.getProcessLogs(
        Number(pid),
        Number(numLines) || 100
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: logs,
          },
        ],
      };
    } catch (error) {
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
  }
);

// Start MCP server
async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Main entry point - detect CLI vs MCP mode
async function main() {
  // Check if running as CLI (has command arguments) or MCP server
  const args = process.argv.slice(2);
  
  // If there are arguments and the first one isn't a flag starting with '--',
  // or if it's a known command, run as CLI
  const cliCommands = ['start', 'list', 'stop', 'logs', '--help', '--version', '-h', '-V'];
  const isCliMode = args.length > 0 && 
    (cliCommands.includes(args[0]) || args[0].startsWith('-'));
  
  if (isCliMode) {
    // Run as CLI
    await runCLI();
  } else {
    // Run as MCP server
    await startMcpServer();
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
