/*
 * Tests for CLI functionality
 * 
 * Validates the command-line interface including:
 * - Process starting with and without persistence
 * - Process listing
 * - Process stopping
 * - Log viewing and streaming
 * - Integration with MCP server
 */

import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from "vitest";
import { execa } from "execa";
import { ProcessManager } from "../src/process-manager";
import path from "path";
import { existsSync, mkdirSync, rmSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import os from "os";

describe("CLI Tests", () => {
  let testDir: string;
  let cliPath: string;
  let processManager: ProcessManager;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `cli-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.CWD = testDir;

    // Path to the CLI
    cliPath = path.join(process.cwd(), "dist", "index.js");

    // Create a process manager for verification - use default config name to match CLI
    processManager = new ProcessManager(testDir);
  });

  afterEach(async () => {
    // Clean up any running processes
    processManager.cleanup();
    
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    
    delete process.env.CWD;
  });

  describe("help command", () => {
    it("should display help information", async () => {
      const result = await execa("node", [cliPath, "--help"]);
      
      expect(result.stdout).toContain("Process Manager MCP");
      expect(result.stdout).toContain("start [options] <command...>");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("stop <pid>");
      expect(result.stdout).toContain("logs [options] <pid>");
      expect(result.exitCode).toBe(0);
    });

    it("should display version", async () => {
      const result = await execa("node", [cliPath, "--version"]);
      
      expect(result.stdout).toContain("0.3.0");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("start command", () => {
    it("should start a process without persistence", async () => {
      // Create a test script that runs for a short time
      const scriptPath = path.join(testDir, "test.sh");
      await writeFile(scriptPath, "#!/bin/bash\necho 'Hello'\necho 'World'\nexit 0", { mode: 0o755 });

      const result = await execa("node", [cliPath, "start", scriptPath], {
        cwd: testDir,
        timeout: 3000,
      });

      expect(result.stdout).toContain("Starting process:");
      expect(result.stdout).toContain("Hello");
      expect(result.stdout).toContain("World");
      expect(result.stdout).toContain("Process completed successfully");
      expect(result.exitCode).toBe(0);
    });

    it("should start a persistent process", async () => {
      // Create a test script that runs indefinitely
      const scriptPath = path.join(testDir, "persistent.sh");
      await writeFile(scriptPath, "#!/bin/bash\nwhile true; do echo 'Running'; sleep 1; done", { mode: 0o755 });

      const result = await execa("node", [cliPath, "start", "--persist", scriptPath], {
        cwd: testDir,
      });

      expect(result.stdout).toContain("Starting process:");
      expect(result.stdout).toContain("Process started with PID:");
      expect(result.stdout).toContain("Process will continue running in the background");
      expect(result.exitCode).toBe(0);

      // Extract PID from output
      const pidMatch = result.stdout.match(/Process started with PID: (\d+)/);
      expect(pidMatch).toBeTruthy();
      const pid = parseInt(pidMatch![1], 10);

      // Verify process is tracked
      const processes = processManager.getCurrentCwdProcesses();
      const foundProcess = Object.values(processes).find(p => p.pid === pid);
      expect(foundProcess).toBeTruthy();

      // Clean up the process
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process might already be dead
      }
    });

    it("should start a process with custom working directory", async () => {
      // Create a subdirectory
      const subDir = path.join(testDir, "subdir");
      mkdirSync(subDir, { recursive: true });

      // Create a test script in the subdirectory
      const scriptPath = path.join(subDir, "test.sh");
      await writeFile(scriptPath, "#!/bin/bash\npwd\nexit 0", { mode: 0o755 });

      const result = await execa("node", [cliPath, "start", "--cwd", "./subdir", "./test.sh"], {
        cwd: testDir,
        timeout: 3000,
      });

      expect(result.stdout).toContain("Working directory:");
      expect(result.stdout).toContain("subdir");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("list command", () => {
    it("should list no processes when none are running", async () => {
      const result = await execa("node", [cliPath, "list"], {
        cwd: testDir,
      });

      expect(result.stdout).toContain("No processes are currently running");
      expect(result.exitCode).toBe(0);
    });

    it("should list running processes", async () => {
      // Start a process using the ProcessManager directly
      const pid = await processManager.startProcess("sleep 10", false);

      // Wait a moment for config to be written
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await execa("node", [cliPath, "list"], {
        cwd: testDir,
      });

      expect(result.stdout).toContain("Running processes:");
      expect(result.stdout).toContain(`PID: ${pid}`);
      expect(result.stdout).toContain("Command: sleep 10");
      expect(result.stdout).toContain("Status: running");
      expect(result.exitCode).toBe(0);

      // Clean up
      await processManager.endProcess(pid);
    });
  });

  describe("stop command", () => {
    it("should stop a running process", async () => {
      // Start a process
      const pid = await processManager.startProcess("sleep 10", false);

      // Wait a moment for config to be written
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await execa("node", [cliPath, "stop", pid.toString()], {
        cwd: testDir,
      });

      expect(result.stdout).toContain("Stopping process");
      expect(result.stdout).toContain("Process stopped successfully");
      expect(result.exitCode).toBe(0);

      // Wait for config to sync after stop
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify process is no longer running (may be marked as crashed by monitoring)
      const processes = processManager.getCurrentCwdProcesses();
      const foundProcess = Object.values(processes).find(p => p.pid === pid);
      // Process should either be removed or marked as not running
      if (foundProcess) {
        expect(foundProcess.status).not.toBe("running");
      }
    });

    it("should fail when stopping non-existent process", async () => {
      try {
        await execa("node", [cliPath, "stop", "99999"], {
          cwd: testDir,
        });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.stderr).toContain("Process not found");
        expect(error.exitCode).toBe(1);
      }
    });

    it("should handle invalid PID", async () => {
      try {
        await execa("node", [cliPath, "stop", "invalid"], {
          cwd: testDir,
        });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.stderr).toContain("Invalid PID");
        expect(error.exitCode).toBe(1);
      }
    });
  });

  describe("logs command", () => {
    it("should show logs for a process", async () => {
      // Start a process that generates output
      const pid = await processManager.startProcess("echo 'Test log output'", false);
      
      // Wait for the process to complete and logs to be written
      await new Promise(resolve => setTimeout(resolve, 1000));

      const result = await execa("node", [cliPath, "logs", pid.toString()], {
        cwd: testDir,
      });

      expect(result.stdout).toContain("Test log output");
      expect(result.exitCode).toBe(0);
    });

    it("should show specified number of log lines", async () => {
      // Start a process that generates multiple lines
      const pid = await processManager.startProcess("for i in {1..10}; do echo \"Line $i\"; done", false);
      
      // Wait for the process to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      const result = await execa("node", [cliPath, "logs", "-n", "5", pid.toString()], {
        cwd: testDir,
      });

      // Should show last 5 lines
      expect(result.stdout).toContain("Line 6");
      expect(result.stdout).toContain("Line 10");
      expect(result.stdout).not.toContain("Line 5");
      expect(result.exitCode).toBe(0);
    });

    it("should handle non-existent process logs", async () => {
      const result = await execa("node", [cliPath, "logs", "99999"], {
        cwd: testDir,
      });

      expect(result.stdout).toContain("No logs available");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Integration with MCP", () => {
    it("should share processes between CLI and MCP modes", async () => {
      // Start a process using CLI
      const scriptPath = path.join(testDir, "shared.sh");
      await writeFile(scriptPath, "#!/bin/bash\nsleep 5", { mode: 0o755 });

      const startResult = await execa("node", [cliPath, "start", "--persist", scriptPath], {
        cwd: testDir,
      });

      // Extract PID
      const pidMatch = startResult.stdout.match(/Process started with PID: (\d+)/);
      expect(pidMatch).toBeTruthy();
      const pid = parseInt(pidMatch![1], 10);

      // Wait for config to sync
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify process is visible to ProcessManager (as used by MCP)
      const processes = processManager.getCurrentCwdProcesses();
      const foundProcess = Object.values(processes).find(p => p.pid === pid);
      expect(foundProcess).toBeTruthy();
      expect(foundProcess!.command).toBe(scriptPath);
      expect(foundProcess!.autoShutdown).toBe(false); // --persist means no auto-shutdown

      // Clean up
      await processManager.endProcess(pid);
    });

    it("should allow CLI to manage MCP-started processes", async () => {
      // Start a process using ProcessManager (simulating MCP)
      const pid = await processManager.startProcess("sleep 10", false);

      // Wait for config to sync
      await new Promise(resolve => setTimeout(resolve, 100));

      // List processes using CLI
      const listResult = await execa("node", [cliPath, "list"], {
        cwd: testDir,
      });

      expect(listResult.stdout).toContain(`PID: ${pid}`);

      // Stop process using CLI
      const stopResult = await execa("node", [cliPath, "stop", pid.toString()], {
        cwd: testDir,
      });

      expect(stopResult.stdout).toContain("Process stopped successfully");

      // Wait longer for config to sync and monitoring to update
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify process is no longer running (may be marked as crashed by monitoring)
      const processes = processManager.getCurrentCwdProcesses();
      const foundProcess = Object.values(processes).find(p => p.pid === pid);
      // Process should either be removed or marked as not running
      if (foundProcess) {
        expect(foundProcess.status).not.toBe("running");
      }
    });
  });
});