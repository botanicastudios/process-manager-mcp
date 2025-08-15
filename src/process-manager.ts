/*
 * ProcessManager class
 * 
 * Handles process lifecycle management, monitoring, and persistence.
 * Provides methods to start, stop, and monitor processes with configurable
 * auto-shutdown behavior and persistent logging.
 */

import { execa } from "execa";
import type { ResultPromise } from "execa";
import Conf from "conf";
import { readFile } from "fs/promises";
import { existsSync, mkdirSync, createWriteStream, openSync } from "fs";
import path from "path";
import os from "os";

// Process status enum
export type ProcessStatus = "running" | "stopped" | "crashed";

// Process data structure
export interface ProcessData {
  pid: number;
  command: string;
  cwd: string;
  status: ProcessStatus;
  startTime: number;
  autoShutdown: boolean;
  logFile?: string;
  errorOutput?: string;
}

// Configuration schema
export type ConfigSchema = {
  [cwd: string]: {
    [processKey: string]: ProcessData;
  };
};

export class ProcessManager {
  private config: Conf<ConfigSchema>;
  private runningProcesses: Map<number, ResultPromise> = new Map();
  private currentCwd: string;
  private monitoringInterval?: NodeJS.Timeout;
  private logDir: string;

  private cleanupHandler = () => this.cleanup();

  constructor(cwd?: string, configName?: string) {
    this.config = new Conf<ConfigSchema>({
      projectName: "process-manager-mcp",
      configName: configName || "processes",
      defaults: {},
    });

    this.currentCwd = cwd || process.env.CWD || process.cwd();
    this.logDir = path.join(os.homedir(), ".process-manager-mcp", "logs");
    
    // Ensure log directory exists
    this.ensureLogDir();
    
    // Clean up stale autoShutdown processes from previous runs
    this.cleanupStaleAutoShutdownProcesses();
    
    // Start monitoring processes
    this.startMonitoring();
    
    // Handle cleanup on exit
    process.on("SIGINT", this.cleanupHandler);
    process.on("SIGTERM", this.cleanupHandler);
    process.on("exit", this.cleanupHandler);
  }

  private ensureLogDir() {
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  private cleanupStaleAutoShutdownProcesses() {
    // Clean up any autoShutdown processes from previous runs
    // These might exist if the server crashed or was forcefully terminated
    const allConfigs = this.config.store;
    
    for (const [cwd, processes] of Object.entries(allConfigs)) {
      for (const [processKey, data] of Object.entries(processes as any)) {
        const processData = data as ProcessData;
        
        // Remove autoShutdown processes that are no longer running
        if (processData.autoShutdown) {
          // Check if the process is still alive
          let isAlive = false;
          try {
            process.kill(processData.pid, 0);
            isAlive = true;
          } catch {
            isAlive = false;
          }
          
          // If the process is dead or marked as stopped/crashed, remove it
          if (!isAlive || processData.status !== "running") {
            // Remove from the specific cwd config
            const cwdConfig = this.config.get(cwd as string, {});
            delete cwdConfig[processKey];
            this.config.set(cwd as string, cwdConfig);
          }
        }
      }
    }
  }

  private generateProcessKey(command: string): string {
    return `${command}_${Date.now()}`;
  }

  private getLogFilePath(pid: number): string {
    return path.join(this.logDir, `process_${pid}.log`);
  }

  async startProcess(command: string, autoShutdown: boolean = true, cwd?: string, env?: Record<string, string>): Promise<number> {
    const processKey = this.generateProcessKey(command);
    const logFile = this.getLogFilePath(Date.now()); // Use timestamp for unique log file
    // Resolve relative paths relative to process.env.CWD or currentCwd
    const baseCwd = process.env.CWD || this.currentCwd;
    const workingDir = cwd ? path.resolve(baseCwd, cwd) : baseCwd;

    try {
      let childProcess: any;
      let pid: number;
      let actualLogFilePath: string;

      if (!autoShutdown) {
        // For persistent processes, we need to get the PID first, then set up logging
        // Use a temporary timestamp for initial log file
        const tempTimestamp = Date.now();
        actualLogFilePath = this.getLogFilePath(tempTimestamp);
        
        // Create the log file first
        const outFd = openSync(actualLogFilePath, 'a');
        const errFd = openSync(actualLogFilePath, 'a');
        
        // Check if this is an npm/yarn/pnpm command that needs stdin
        const needsStdin = /^(npm|yarn|pnpm|npx)\s/.test(command);
        
        childProcess = execa(command, {
          shell: true,
          cwd: workingDir,
          stdio: needsStdin ? ["pipe", outFd, errFd] as any : ["ignore", outFd, errFd] as any,
          detached: true,
          env: env ? { ...process.env, ...env } : process.env,
        } as any);

        if (!childProcess.pid) {
          throw new Error("Failed to start process: No PID returned");
        }
        pid = childProcess.pid;
        
        // For npm/yarn/pnpm commands, keep stdin open but don't write to it
        if (needsStdin && childProcess.stdin) {
          // Keep stdin open to prevent npm from exiting
          // We don't close it, which keeps the process running
        }
        
        // Unref the process so it can continue after parent exits
        childProcess.unref();
      } else {
        // For auto-shutdown processes, use pipe to capture output
        childProcess = execa(command, {
          shell: true,
          cwd: workingDir,
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
          env: env ? { ...process.env, ...env } : process.env,
        });

        if (!childProcess.pid) {
          throw new Error("Failed to start process: No PID returned");
        }
        pid = childProcess.pid;
        actualLogFilePath = this.getLogFilePath(pid);

        // Set up log redirection for auto-shutdown processes
        const logStream = createWriteStream(actualLogFilePath, { flags: "a" });
        
        // Handle stream errors to prevent crashes
        logStream.on('error', (error: any) => {
          // Log stream error, but don't crash the process
          console.warn(`Log stream error for PID ${pid}:`, error.message);
        });
        
        if (childProcess.stdout) {
          childProcess.stdout.on('error', (error: any) => {
            console.warn(`Stdout error for PID ${pid}:`, error.message);
          });
          childProcess.stdout.pipe(logStream, { end: false });
        }
        
        if (childProcess.stderr) {
          childProcess.stderr.on('error', (error: any) => {
            console.warn(`Stderr error for PID ${pid}:`, error.message);
          });
          childProcess.stderr.pipe(logStream, { end: false });
        }

        // Handle process completion for auto-shutdown processes
        childProcess.on("exit", (code: any, signal: any) => {
          this.runningProcesses.delete(pid);
          
          // Safely close the log stream
          setTimeout(() => {
            try {
              if (!logStream.destroyed) {
                logStream.end();
              }
            } catch (error) {
              // Ignore stream closing errors
            }
          }, 100);
          
          const processData = this.getProcessData(processKey);
          if (processData) {
            if (code === 0) {
              processData.status = "stopped";
            } else {
              processData.status = "crashed";
              processData.errorOutput = `Process exited with code ${code}, signal: ${signal}`;
            }
            this.updateProcessData(processKey, processData);
          }
        });
      }

      // Store the running process
      this.runningProcesses.set(pid, childProcess);

      // Handle promise rejections to prevent unhandled rejections
      childProcess.catch((error: any) => {
        // Process was killed or failed, update status if still tracked
        const processData = this.getProcessData(processKey);
        if (processData && processData.status === "running") {
          processData.status = "crashed";
          processData.errorOutput = `Process failed: ${error.message}`;
          this.updateProcessData(processKey, processData);
        }
      });

      // Store process data
      const processData: ProcessData = {
        pid,
        command,
        cwd: workingDir,
        status: "running",
        startTime: Date.now(),
        autoShutdown,
        logFile: actualLogFilePath,
      };

      this.storeProcessData(processKey, processData);
      return pid;
    } catch (error) {
      throw new Error(`Failed to start process: ${error}`);
    }
  }

  async endProcess(pid: number): Promise<boolean> {
    let processToKill: ProcessData | null = null;
    let processKey: string | null = null;
    let processCwd: string | null = null;

    // Find the process by PID across all directories
    const allConfigs = this.config.store;
    
    for (const [cwd, processes] of Object.entries(allConfigs)) {
      for (const [key, data] of Object.entries(processes as any)) {
        const processData = data as ProcessData;
        if (processData.pid === pid) {
          processToKill = processData;
          processKey = key;
          processCwd = cwd;
          break;
        }
      }
      if (processToKill) break;
    }

    if (!processToKill || !processKey || !processCwd) {
      return false;
    }

    let killSuccess = false;
    let processIsAlive = false;

    // First check if the process is actually alive
    try {
      process.kill(processToKill.pid, 0);
      processIsAlive = true;
    } catch {
      processIsAlive = false;
    }

    // If process is alive, try to kill it
    if (processIsAlive) {
      try {
        // Kill the process
        const runningProcess = this.runningProcesses.get(processToKill.pid);
        if (runningProcess) {
          // Handle the promise to prevent unhandled rejection
          runningProcess.catch(() => {
            // Process termination error, ignore
          });
          runningProcess.kill("SIGTERM");
          this.runningProcesses.delete(processToKill.pid);
          killSuccess = true;
        } else {
          // Process might be detached, try killing by PID
          process.kill(processToKill.pid, "SIGTERM");
          killSuccess = true;
        }
      } catch (error) {
        // Kill failed
        killSuccess = false;
      }
    }

    // Always remove from config - either we killed it, or it was already dead
    this.removeProcessData(processKey, processCwd);
    
    // Return true if we successfully killed it OR if it was already dead (stale)
    return killSuccess || !processIsAlive;
  }

  private storeProcessData(processKey: string, data: ProcessData, cwd?: string) {
    const targetCwd = cwd || this.currentCwd;
    const config = this.config.get(targetCwd, {});
    config[processKey] = data;
    this.config.set(targetCwd, config);
  }

  private updateProcessData(processKey: string, data: ProcessData, cwd?: string) {
    const targetCwd = cwd || this.currentCwd;
    const config = this.config.get(targetCwd, {});
    if (config[processKey]) {
      config[processKey] = data;
      this.config.set(targetCwd, config);
    }
  }

  private removeProcessData(processKey: string, cwd?: string) {
    const targetCwd = cwd || this.currentCwd;
    const config = this.config.get(targetCwd, {});
    delete config[processKey];
    this.config.set(targetCwd, config);
  }

  private getProcessData(processKey: string): ProcessData | null {
    const config = this.config.get(this.currentCwd, {});
    return config[processKey] || null;
  }

  public getCurrentCwdProcesses(): { [key: string]: ProcessData } {
    return this.config.get(this.currentCwd, {});
  }

  public getAllProcessesInDirectory(includeSubdirectories: boolean = true): { [key: string]: ProcessData } {
    const allConfigs = this.config.store;
    const result: { [key: string]: ProcessData } = {};
    const targetCwd = this.currentCwd;
    
    for (const [cwd, processes] of Object.entries(allConfigs)) {
      // Check if this cwd matches our criteria
      let shouldInclude = false;
      
      if (includeSubdirectories) {
        // Include if cwd is the target directory or a subdirectory of it
        shouldInclude = cwd === targetCwd || cwd.startsWith(targetCwd + path.sep);
      } else {
        // Only include exact match
        shouldInclude = cwd === targetCwd;
      }
      
      if (shouldInclude) {
        // Add all processes from this cwd
        for (const [processKey, data] of Object.entries(processes as any)) {
          result[`${cwd}::${processKey}`] = data as ProcessData;
        }
      }
    }
    
    return result;
  }

  public getAllProcesses(): { [key: string]: ProcessData } {
    const allConfigs = this.config.store;
    const result: { [key: string]: ProcessData } = {};
    
    for (const [cwd, processes] of Object.entries(allConfigs)) {
      for (const [processKey, data] of Object.entries(processes as any)) {
        result[`${cwd}::${processKey}`] = data as ProcessData;
      }
    }
    
    return result;
  }

  async getProcessLogs(pid: number, tailLength: number = 100): Promise<string> {
    // Search across all processes to find the log file
    const allProcesses = this.getAllProcesses();
    let logFile: string | undefined;

    // Find the log file for this PID
    for (const data of Object.values(allProcesses)) {
      if (data.pid === pid && data.logFile) {
        logFile = data.logFile;
        break;
      }
    }

    if (!logFile || !existsSync(logFile)) {
      return "No logs available for this process";
    }

    try {
      const content = await readFile(logFile, "utf-8");
      const lines = content.split("\n").filter(line => line !== "");
      return lines.slice(-tailLength).join("\n");
    } catch (error) {
      return `Error reading logs: ${error}`;
    }
  }

  private startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      this.checkProcessHealth();
    }, 5000);
  }

  public checkProcessHealth() {
    const processes = this.getCurrentCwdProcesses();
    
    for (const [processKey, data] of Object.entries(processes)) {
      if (data.status === "running") {
        try {
          // Check if process is still running
          process.kill(data.pid, 0);
        } catch (error) {
          // Process is not running
          data.status = "stopped";
          this.updateProcessData(processKey, data);
          this.runningProcesses.delete(data.pid);
        }
      }
    }
  }

  public cleanup() {
    // Remove event listeners to prevent memory leaks
    process.removeListener("SIGINT", this.cleanupHandler);
    process.removeListener("SIGTERM", this.cleanupHandler);
    process.removeListener("exit", this.cleanupHandler);

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Kill auto-shutdown processes and remove them from config
    const processes = this.getCurrentCwdProcesses();
    
    for (const [processKey, data] of Object.entries(processes)) {
      if (data.autoShutdown) {
        // Try to kill the process if it's running
        if (data.status === "running") {
          try {
            const runningProcess = this.runningProcesses.get(data.pid);
            if (runningProcess) {
              // Ensure the promise is handled to prevent unhandled rejection
              runningProcess.catch(() => {
                // Process termination error, ignore
              });
              runningProcess.kill("SIGTERM");
            } else {
              process.kill(data.pid, "SIGTERM");
            }
          } catch (error) {
            // Process might already be dead
          }
        }
        // Always remove autoShutdown processes from config on cleanup
        this.removeProcessData(processKey);
      }
    }
  }

  // Test helper methods
  public getConfig() {
    return this.config;
  }

  public getRunningProcesses() {
    return this.runningProcesses;
  }

  public setCurrentCwd(cwd: string) {
    this.currentCwd = cwd;
  }

  public getCurrentCwd() {
    return this.currentCwd;
  }

  public getLogDir() {
    return this.logDir;
  }
}