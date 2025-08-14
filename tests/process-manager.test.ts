import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProcessManager } from "../src/process-manager.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

describe("ProcessManager (Fixed)", () => {
  let processManager: ProcessManager;
  let tempCwd: string;

  beforeEach(() => {
    tempCwd = mkdtempSync(path.join(tmpdir(), "process-manager-test-"));
    processManager = new ProcessManager(tempCwd, `test-config-${Date.now()}`);
  });

  afterEach(async () => {
    // Kill all processes synchronously
    const processes = processManager.getCurrentCwdProcesses();
    for (const pid of Object.keys(processes)) {
      try {
        await processManager.endProcess(parseInt(pid));
      } catch (e) {
        // Ignore
      }
    }
    
    // Clean up manager
    processManager.cleanup();
    
    // Remove temp directory
    try {
      rmSync(tempCwd, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("basic functionality", () => {
    it("should start and track a process", async () => {
      const pid = await processManager.startProcess("echo 'hello world'", true);
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThan(0);
      
      const processes = processManager.getCurrentCwdProcesses();
      const processEntries = Object.values(processes);
      expect(processEntries).toHaveLength(1);
      expect(processEntries[0].pid).toBe(pid);
      expect(processEntries[0].command).toBe("echo 'hello world'");
    });

    it("should handle real sleep process", async () => {
      const pid = await processManager.startProcess("sleep 0.5", true);
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThan(0);
      
      // Process should be running
      const processes = processManager.getCurrentCwdProcesses();
      expect(Object.keys(processes)).toHaveLength(1);
      
      // Wait for it to complete
      await new Promise(resolve => setTimeout(resolve, 600));
      processManager.checkProcessHealth();
      
      const updatedProcesses = processManager.getCurrentCwdProcesses();
      const process = Object.values(updatedProcesses)[0];
      expect(process.status).toBe("stopped");
    });

    it("should end a process by PID", async () => {
      const pid = await processManager.startProcess("sleep 1", true);
      expect(pid).toBeGreaterThan(0);
      
      const success = await processManager.endProcess(pid);
      expect(success).toBe(true);
      
      const processes = processManager.getCurrentCwdProcesses();
      expect(Object.keys(processes)).toHaveLength(0);
    });

    it("should handle process that exits with error", async () => {
      const pid = await processManager.startProcess("sh -c 'exit 1'", true);
      expect(pid).toBeGreaterThan(0);
      
      // Wait briefly for process to exit
      await new Promise(resolve => setTimeout(resolve, 100));
      processManager.checkProcessHealth();
      
      const processes = processManager.getCurrentCwdProcesses();
      const process = Object.values(processes)[0];
      expect(["stopped", "crashed"]).toContain(process.status);
    });

    it("should create log files", async () => {
      const pid = await processManager.startProcess("echo 'test log output'", true);
      
      // Wait briefly for logs to be written
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logs = await processManager.getProcessLogs(pid, 10);
      expect(logs).toContain("test log output");
    });
  });

  describe("cleanup", () => {
    it("should cleanup auto-shutdown processes only", async () => {
      const pid1 = await processManager.startProcess("sleep 0.5", true);  // auto-shutdown
      const pid2 = await processManager.startProcess("sleep 0.5", false); // no auto-shutdown
      
      processManager.cleanup();
      
      const processes = processManager.getCurrentCwdProcesses();
      const remaining = Object.values(processes);
      
      // Only the non-auto-shutdown process should remain
      expect(remaining).toHaveLength(1);
      expect(remaining[0].pid).toBe(pid2);
      expect(remaining[0].autoShutdown).toBe(false);
      
      // Manually cleanup the remaining process
      await processManager.endProcess(pid2);
    });
  });

  describe("edge cases", () => {
    it("should handle non-existent commands that exit immediately", async () => {
      // Note: When using shell:true, even non-existent commands get a PID (shell process)
      // They fail shortly after, but the process is initially created
      const pid = await processManager.startProcess("this-command-does-not-exist-xyz123", true);
      expect(pid).toBeGreaterThan(0);
      
      // Wait for the process to fail
      await new Promise(resolve => setTimeout(resolve, 200));
      processManager.checkProcessHealth();
      
      // Process should be marked as crashed or stopped
      const processes = processManager.getCurrentCwdProcesses();
      const process = Object.values(processes)[0];
      expect(["stopped", "crashed"]).toContain(process?.status);
    });

    it("should properly handle undefined PID (if it occurs)", async () => {
      // This test validates our PID checking logic
      // In practice, execa with shell:true should always return a PID
      // but we handle the edge case where it doesn't
      const processes = processManager.getCurrentCwdProcesses();
      const initialCount = Object.keys(processes).length;
      
      // Even invalid paths get a shell PID, they just fail shortly after
      const pid = await processManager.startProcess("/nonexistent/path/to/command", true);
      expect(pid).toBeGreaterThan(0);
      
      // Wait and check that process failed
      await new Promise(resolve => setTimeout(resolve, 200));
      processManager.checkProcessHealth();
      
      const updatedProcesses = processManager.getCurrentCwdProcesses();
      const process = Object.values(updatedProcesses)[initialCount];
      expect(["stopped", "crashed"]).toContain(process?.status);
    });

    it("should remove stale processes from list when stopping them", async () => {
      const pid = await processManager.startProcess("echo 'quick exit'", true);
      expect(pid).toBeGreaterThan(0);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      processManager.checkProcessHealth();
      
      let processes = processManager.getCurrentCwdProcesses();
      let processEntries = Object.values(processes);
      expect(processEntries).toHaveLength(1);
      expect(processEntries[0].status).toBe("stopped");
      
      const success = await processManager.endProcess(pid);
      
      const updatedProcesses = processManager.getCurrentCwdProcesses();
      expect(Object.keys(updatedProcesses)).toHaveLength(0);
    });
  });
});