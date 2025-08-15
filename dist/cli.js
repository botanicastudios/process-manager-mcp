/*
 * CLI Module for Process Manager
 *
 * Provides command-line interface for managing processes with support for:
 * - Starting processes with optional streaming logs
 * - Listing running processes
 * - Stopping processes by PID
 * - Viewing process logs with tail functionality
 * - Integration with MCP server for shared process management
 */
import { Command } from "commander";
import { ProcessManager } from "./process-manager.js";
import { execa } from "execa";
import path from "path";
import { existsSync } from "fs";
export class ProcessManagerCLI {
    program;
    processManager;
    constructor() {
        this.processManager = new ProcessManager();
        this.program = new Command();
        this.setupCommands();
    }
    setupCommands() {
        this.program
            .name("process-manager-mcp")
            .description("Process Manager MCP - Manage processes via CLI or MCP server")
            .version("0.3.0");
        // Start command
        this.program
            .command("start <command...>")
            .description("Start a new process")
            .option("-c, --cwd <path>", "Working directory for the process")
            .option("-p, --persist", "Keep process running after Ctrl+C", false)
            .action(async (commandArgs, options) => {
            await this.startCommand(commandArgs.join(" "), options);
        });
        // List command
        this.program
            .command("list")
            .description("List all managed processes")
            .action(async () => {
            await this.listCommand();
        });
        // Stop command
        this.program
            .command("stop <target>")
            .description("Stop a managed process by PID or use 'all' to stop all processes")
            .action(async (target) => {
            if (target.toLowerCase() === "all") {
                await this.stopAllCommand();
            }
            else {
                const pid = parseInt(target, 10);
                if (isNaN(pid)) {
                    console.error("Invalid PID. Please provide a valid number or use 'all' to stop all processes.");
                    process.exit(1);
                }
                await this.stopCommand(pid);
            }
        });
        // Logs command
        this.program
            .command("logs <pid>")
            .description("View logs for a managed process")
            .option("-t, --tail", "Stream logs in real-time", false)
            .option("-n, --num-lines <number>", "Number of lines to display", "100")
            .action(async (pidStr, options) => {
            await this.logsCommand(parseInt(pidStr, 10), options);
        });
    }
    async startCommand(command, options) {
        const baseCwd = process.env.CWD || process.cwd();
        const workingDir = options.cwd ? path.resolve(baseCwd, options.cwd) : baseCwd;
        console.log(`Starting process: ${command}`);
        if (options.cwd) {
            console.log(`Working directory: ${workingDir}`);
        }
        console.log(`Persist after exit: ${options.persist ? "yes" : "no"}`);
        console.log("");
        try {
            // If not persisting, run the process inline and stream logs
            if (!options.persist) {
                const childProcess = execa(command, {
                    shell: true,
                    cwd: workingDir,
                    stdio: ["inherit", "pipe", "pipe"],
                });
                if (!childProcess.pid) {
                    console.error("Failed to start process: No PID returned");
                    process.exit(1);
                }
                console.log(`Process started with PID: ${childProcess.pid}`);
                console.log("Streaming logs (Ctrl+C to stop)...\n");
                // Stream stdout and stderr to console
                if (childProcess.stdout) {
                    childProcess.stdout.pipe(process.stdout);
                }
                if (childProcess.stderr) {
                    childProcess.stderr.pipe(process.stderr);
                }
                // Handle Ctrl+C
                process.on("SIGINT", () => {
                    console.log("\nStopping process...");
                    childProcess.kill("SIGTERM");
                    process.exit(0);
                });
                // Wait for process to complete
                try {
                    await childProcess;
                    console.log("\nProcess completed successfully");
                    process.exit(0);
                }
                catch (error) {
                    if (error.signal === "SIGTERM") {
                        console.log("Process terminated");
                        process.exit(0);
                    }
                    else {
                        console.error(`\nProcess failed with exit code ${error.exitCode}`);
                        process.exit(1);
                    }
                }
            }
            else {
                // Use ProcessManager to start a persistent process
                const pid = await this.processManager.startProcess(command, false, options.cwd);
                console.log(`Process started with PID: ${pid}`);
                console.log("Process will continue running in the background");
                console.log(`Use 'process-manager-mcp logs ${pid}' to view logs`);
                console.log(`Use 'process-manager-mcp stop ${pid}' to stop the process`);
                process.exit(0);
            }
        }
        catch (error) {
            console.error(`Failed to start process: ${error}`);
            process.exit(1);
        }
    }
    async listCommand() {
        const processes = this.processManager.getCurrentCwdProcesses();
        const processList = Object.entries(processes);
        if (processList.length === 0) {
            console.log("No processes are currently running.");
            process.exit(0);
        }
        console.log("Running processes:\n");
        for (const [_, data] of processList) {
            console.log(`PID: ${data.pid}`);
            console.log(`Command: ${data.command}`);
            console.log(`Status: ${data.status}`);
            console.log(`Started: ${new Date(data.startTime).toISOString()}`);
            console.log(`Auto-shutdown: ${data.autoShutdown}`);
            console.log(`Working Directory: ${data.cwd}`);
            if (data.errorOutput) {
                console.log(`Error: ${data.errorOutput}`);
            }
            console.log("");
        }
        process.exit(0);
    }
    async stopCommand(pid) {
        console.log(`Stopping process ${pid}...`);
        // Check if process exists in our list
        const processes = this.processManager.getCurrentCwdProcesses();
        let processExists = false;
        let isAlive = false;
        for (const data of Object.values(processes)) {
            if (data.pid === pid) {
                processExists = true;
                // Check if the process is actually running
                try {
                    process.kill(pid, 0);
                    isAlive = true;
                }
                catch {
                    isAlive = false;
                }
                break;
            }
        }
        if (!processExists) {
            console.error("Process not found in manager");
            process.exit(1);
        }
        try {
            const success = await this.processManager.endProcess(pid);
            if (success) {
                if (!isAlive) {
                    console.log("Process not found or already stopped, removing from manager");
                }
                else {
                    console.log("Process stopped successfully");
                }
                process.exit(0);
            }
            else {
                console.error("Process not found or could not be stopped");
                process.exit(1);
            }
        }
        catch (error) {
            console.error(`Failed to stop process: ${error}`);
            process.exit(1);
        }
    }
    async stopAllCommand() {
        const processes = this.processManager.getCurrentCwdProcesses();
        const processList = Object.entries(processes);
        if (processList.length === 0) {
            console.log("No processes are currently running.");
            process.exit(0);
        }
        console.log(`Stopping ${processList.length} process(es)...\n`);
        let successCount = 0;
        let staleCount = 0;
        let failureCount = 0;
        for (const [_, data] of processList) {
            try {
                // Check if the process is actually running
                let isAlive = false;
                try {
                    process.kill(data.pid, 0);
                    isAlive = true;
                }
                catch {
                    isAlive = false;
                }
                console.log(`Stopping process ${data.pid} (${data.command})...`);
                const success = await this.processManager.endProcess(data.pid);
                if (success) {
                    if (!isAlive) {
                        console.log(`  ✓ Process not found or already stopped, removed from manager`);
                        staleCount++;
                    }
                    else {
                        console.log(`  ✓ Stopped successfully`);
                        successCount++;
                    }
                }
                else {
                    console.log(`  ✗ Failed to stop`);
                    failureCount++;
                }
            }
            catch (error) {
                console.log(`  ✗ Error: ${error}`);
                failureCount++;
            }
        }
        console.log(`\nSummary: ${successCount} stopped, ${staleCount} removed (stale), ${failureCount} failed`);
        process.exit(failureCount > 0 ? 1 : 0);
    }
    async logsCommand(pid, options) {
        if (isNaN(pid)) {
            console.error("Invalid PID. Please provide a valid number.");
            process.exit(1);
        }
        const numLines = options.numLines ? parseInt(options.numLines.toString(), 10) : 100;
        if (options.tail) {
            // Stream logs in real-time
            console.log(`Streaming logs for process ${pid} (Ctrl+C to stop)...\n`);
            // First, get the log file path
            const processes = this.processManager.getCurrentCwdProcesses();
            let logFile;
            for (const data of Object.values(processes)) {
                if (data.pid === pid && data.logFile) {
                    logFile = data.logFile;
                    break;
                }
            }
            if (!logFile || !existsSync(logFile)) {
                console.error("No logs available for this process");
                process.exit(1);
            }
            // Use tail to stream the log file
            const tailProcess = execa("tail", ["-f", "-n", numLines.toString(), logFile], {
                stdio: ["ignore", "pipe", "pipe"],
            });
            if (tailProcess.stdout) {
                tailProcess.stdout.pipe(process.stdout);
            }
            if (tailProcess.stderr) {
                tailProcess.stderr.pipe(process.stderr);
            }
            // Handle Ctrl+C
            process.on("SIGINT", () => {
                tailProcess.kill("SIGTERM");
                process.exit(0);
            });
            try {
                await tailProcess;
            }
            catch (error) {
                // Tail was terminated
            }
        }
        else {
            // Show static logs
            try {
                const logs = await this.processManager.getProcessLogs(pid, numLines);
                console.log(logs);
                process.exit(0);
            }
            catch (error) {
                console.error(`Failed to retrieve logs: ${error}`);
                process.exit(1);
            }
        }
    }
    async run() {
        await this.program.parseAsync(process.argv);
    }
    cleanup() {
        // Clean up process manager resources
        this.processManager.cleanup();
    }
}
// Export a function to run the CLI
export async function runCLI() {
    const cli = new ProcessManagerCLI();
    await cli.run();
}
//# sourceMappingURL=cli.js.map