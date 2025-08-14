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
import { existsSync, mkdirSync, createWriteStream } from "fs";
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

  async startProcess(command: string, autoShutdown: boolean = true, cwd?: string): Promise<number> {
    const processKey = this.generateProcessKey(command);
    const logFile = this.getLogFilePath(Date.now()); // Use timestamp for unique log file
    // Resolve relative paths relative to process.env.CWD or currentCwd
    const baseCwd = process.env.CWD || this.currentCwd;
    const workingDir = cwd ? path.resolve(baseCwd, cwd) : baseCwd;

    try {
      // Start the process
      const childProcess = execa(command, {
        shell: true,
        cwd: workingDir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: !autoShutdown, // Detach if not auto-shutdown to persist after MCP server stops
      });

      if (!childProcess.pid) {
        throw new Error("Failed to start process: No PID returned");
      }
      const pid = childProcess.pid;
      const logFilePath = this.getLogFilePath(pid);

      // Store the running process
      this.runningProcesses.set(pid, childProcess);

      // Set up log redirection
      const logStream = createWriteStream(logFilePath, { flags: "a" });
      
      // Handle stream errors to prevent crashes
      logStream.on('error', (error) => {
        // Log stream error, but don't crash the process
        console.warn(`Log stream error for PID ${pid}:`, error.message);
      });
      
      if (childProcess.stdout) {
        childProcess.stdout.on('error', (error) => {
          console.warn(`Stdout error for PID ${pid}:`, error.message);
        });
        childProcess.stdout.pipe(logStream, { end: false });
      }
      
      if (childProcess.stderr) {
        childProcess.stderr.on('error', (error) => {
          console.warn(`Stderr error for PID ${pid}:`, error.message);
        });
        childProcess.stderr.pipe(logStream, { end: false });
      }

      // Handle process completion
      childProcess.on("exit", (code, signal) => {
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

      // Handle promise rejections to prevent unhandled rejections
      childProcess.catch((error) => {
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
        logFile: logFilePath,
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

    // Find the process by PID
    const processes = this.getCurrentCwdProcesses();
    for (const [key, data] of Object.entries(processes)) {
      if (data.pid === pid) {
        processToKill = data;
        processKey = key;
        break;
      }
    }

    if (!processToKill || !processKey) {
      return false;
    }

    let killSuccess = false;

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
      // Kill failed, but we should still check if process is stale
      killSuccess = false;
    }

    // Always remove from config if process is stopped/crashed or kill succeeded
    if (processToKill.status === "stopped" || processToKill.status === "crashed" || killSuccess) {
      this.removeProcessData(processKey);
      return true;
    }

    return false;
  }

  private storeProcessData(processKey: string, data: ProcessData) {
    const config = this.config.get(this.currentCwd, {});
    config[processKey] = data;
    this.config.set(this.currentCwd, config);
  }

  private updateProcessData(processKey: string, data: ProcessData) {
    const config = this.config.get(this.currentCwd, {});
    if (config[processKey]) {
      config[processKey] = data;
      this.config.set(this.currentCwd, config);
    }
  }

  private removeProcessData(processKey: string) {
    const config = this.config.get(this.currentCwd, {});
    delete config[processKey];
    this.config.set(this.currentCwd, config);
  }

  private getProcessData(processKey: string): ProcessData | null {
    const config = this.config.get(this.currentCwd, {});
    return config[processKey] || null;
  }

  public getCurrentCwdProcesses(): { [key: string]: ProcessData } {
    return this.config.get(this.currentCwd, {});
  }

  async getProcessLogs(pid: number, tailLength: number = 100): Promise<string> {
    const processes = this.getCurrentCwdProcesses();
    let logFile: string | undefined;

    // Find the log file for this PID
    for (const data of Object.values(processes)) {
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
      const lines = content.split("\n");
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