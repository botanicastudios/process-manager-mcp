import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProcessManager } from "../src/process-manager.js";
import type { ProcessData } from "../src/process-manager.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

describe("Process Monitoring and Cleanup", () => {
  let processManager: ProcessManager;
  let tempCwd: string;
  let originalKill: typeof process.kill;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempCwd = mkdtempSync(path.join(tmpdir(), "monitoring-test-"));
    
    // Create ProcessManager with test directory and unique config
    processManager = new ProcessManager(tempCwd, `test-monitoring-${Date.now()}`);

    // Mock process.kill for controlled testing
    originalKill = process.kill;
  });

  afterEach(() => {
    // Restore original process.kill
    process.kill = originalKill;
    
    // Cleanup
    processManager.cleanup();
    
    // Remove temporary directory
    try {
      rmSync(tempCwd, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("health monitoring", () => {
    it("should detect when a running process is no longer active", () => {
      // Mock a process that appears to be running initially
      const mockProcessData: ProcessData = {
        pid: 12345,
        command: "test command",
        cwd: tempCwd,
        status: "running",
        startTime: Date.now(),
        autoShutdown: true,
      };

      // Manually add process to config to simulate existing process
      const config = processManager.getConfig();
      const cwdProcesses = config.get(tempCwd, {});
      cwdProcesses["test_process"] = mockProcessData;
      config.set(tempCwd, cwdProcesses);

      // Mock process.kill to throw (simulating process not found)
      process.kill = vi.fn().mockImplementation((pid: number, signal: string | number = 0) => {
        if (pid === 12345 && signal === 0) {
          throw new Error("ESRCH: No such process");
        }
        return originalKill(pid, signal);
      });

      // Run health check
      processManager.checkProcessHealth();

      // Verify process status was updated to stopped
      const updatedProcesses = processManager.getCurrentCwdProcesses();
      expect(updatedProcesses["test_process"].status).toBe("stopped");
    });

    it("should keep running processes as running when they are still active", () => {
      const mockProcessData: ProcessData = {
        pid: 12345,
        command: "test command",
        cwd: tempCwd,
        status: "running",
        startTime: Date.now(),
        autoShutdown: true,
      };

      // Manually add process to config
      const config = processManager.getConfig();
      const cwdProcesses = config.get(tempCwd, {});
      cwdProcesses["test_process"] = mockProcessData;
      config.set(tempCwd, cwdProcesses);

      // Mock process.kill to succeed (simulating process still running)
      process.kill = vi.fn().mockImplementation((pid: number, signal: string | number = 0) => {
        if (pid === 12345 && signal === 0) {
          return true; // Process exists
        }
        return originalKill(pid, signal);
      });

      // Run health check
      processManager.checkProcessHealth();

      // Verify process status remains running
      const updatedProcesses = processManager.getCurrentCwdProcesses();
      expect(updatedProcesses["test_process"].status).toBe("running");
    });

    it("should not check health for already stopped processes", () => {
      const mockProcessData: ProcessData = {
        pid: 12345,
        command: "test command",
        cwd: tempCwd,
        status: "stopped",
        startTime: Date.now(),
        autoShutdown: true,
      };

      // Manually add stopped process to config
      const config = processManager.getConfig();
      const cwdProcesses = config.get(tempCwd, {});
      cwdProcesses["test_process"] = mockProcessData;
      config.set(tempCwd, cwdProcesses);

      // Mock process.kill to count calls
      const killSpy = vi.fn();
      process.kill = killSpy;

      // Run health check
      processManager.checkProcessHealth();

      // Verify process.kill was not called for stopped process
      expect(killSpy).not.toHaveBeenCalled();
      
      // Status should remain stopped
      const updatedProcesses = processManager.getCurrentCwdProcesses();
      expect(updatedProcesses["test_process"].status).toBe("stopped");
    });

    it("should not check health for crashed processes", () => {
      const mockProcessData: ProcessData = {
        pid: 12345,
        command: "test command",
        cwd: tempCwd,
        status: "crashed",
        startTime: Date.now(),
        autoShutdown: true,
        errorOutput: "Process crashed",
      };

      // Manually add crashed process to config
      const config = processManager.getConfig();
      const cwdProcesses = config.get(tempCwd, {});
      cwdProcesses["test_process"] = mockProcessData;
      config.set(tempCwd, cwdProcesses);

      // Mock process.kill to count calls
      const killSpy = vi.fn();
      process.kill = killSpy;

      // Run health check
      processManager.checkProcessHealth();

      // Verify process.kill was not called for crashed process
      expect(killSpy).not.toHaveBeenCalled();
      
      // Status should remain crashed
      const updatedProcesses = processManager.getCurrentCwdProcesses();
      expect(updatedProcesses["test_process"].status).toBe("crashed");
    });

    it("should handle multiple processes with different statuses", () => {
      const processes = {
        "running_process": {
          pid: 100,
          command: "running command",
          cwd: tempCwd,
          status: "running" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
        "stopped_process": {
          pid: 101,
          command: "stopped command",
          cwd: tempCwd,
          status: "stopped" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
        "dead_process": {
          pid: 102,
          command: "dead command",
          cwd: tempCwd,
          status: "running" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
      };

      // Add processes to config
      const config = processManager.getConfig();
      config.set(tempCwd, processes);

      // Mock process.kill: 100 exists, 101 not checked, 102 doesn't exist
      process.kill = vi.fn().mockImplementation((pid: number, signal: string | number = 0) => {
        if (signal === 0) {
          if (pid === 100) return true; // Running process exists
          if (pid === 102) throw new Error("ESRCH: No such process"); // Dead process
        }
        return originalKill(pid, signal);
      });

      // Run health check
      processManager.checkProcessHealth();

      const updatedProcesses = processManager.getCurrentCwdProcesses();
      
      // Running process should stay running
      expect(updatedProcesses["running_process"].status).toBe("running");
      
      // Stopped process should stay stopped
      expect(updatedProcesses["stopped_process"].status).toBe("stopped");
      
      // Dead process should be marked as stopped
      expect(updatedProcesses["dead_process"].status).toBe("stopped");
    });
  });

  describe("cleanup functionality", () => {
    it("should kill only auto-shutdown processes during cleanup", () => {
      const processes = {
        "auto_shutdown_process": {
          pid: 100,
          command: "auto shutdown command",
          cwd: tempCwd,
          status: "running" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
        "persistent_process": {
          pid: 101,
          command: "persistent command",
          cwd: tempCwd,
          status: "running" as const,
          startTime: Date.now(),
          autoShutdown: false,
        },
      };

      // Add processes to config
      const config = processManager.getConfig();
      config.set(tempCwd, processes);

      // Mock process.kill to track calls
      const killCalls: Array<{ pid: number; signal: string | number }> = [];
      process.kill = vi.fn().mockImplementation((pid: number, signal: string | number = "SIGTERM") => {
        killCalls.push({ pid, signal });
        return true;
      });

      // Run cleanup
      processManager.cleanup();

      // Should only kill the auto-shutdown process
      expect(killCalls).toHaveLength(1);
      expect(killCalls[0]).toEqual({ pid: 100, signal: "SIGTERM" });

      // Auto-shutdown process should be removed from config
      const remainingProcesses = processManager.getCurrentCwdProcesses();
      expect(remainingProcesses["auto_shutdown_process"]).toBeUndefined();
      expect(remainingProcesses["persistent_process"]).toBeDefined();
    });

    it("should not attempt to kill stopped processes during cleanup", () => {
      const processes = {
        "stopped_auto_shutdown": {
          pid: 100,
          command: "stopped command",
          cwd: tempCwd,
          status: "stopped" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
      };

      // Add processes to config
      const config = processManager.getConfig();
      config.set(tempCwd, processes);

      // Mock process.kill to track calls
      const killSpy = vi.fn();
      process.kill = killSpy;

      // Run cleanup
      processManager.cleanup();

      // Should not attempt to kill stopped process
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("should not attempt to kill crashed processes during cleanup", () => {
      const processes = {
        "crashed_auto_shutdown": {
          pid: 100,
          command: "crashed command",
          cwd: tempCwd,
          status: "crashed" as const,
          startTime: Date.now(),
          autoShutdown: true,
          errorOutput: "Process crashed",
        },
      };

      // Add processes to config
      const config = processManager.getConfig();
      config.set(tempCwd, processes);

      // Mock process.kill to track calls
      const killSpy = vi.fn();
      process.kill = killSpy;

      // Run cleanup
      processManager.cleanup();

      // Should not attempt to kill crashed process
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("should handle cleanup errors gracefully", () => {
      const processes = {
        "problematic_process": {
          pid: 100,
          command: "problematic command",
          cwd: tempCwd,
          status: "running" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
      };

      // Add process to config
      const config = processManager.getConfig();
      config.set(tempCwd, processes);

      // Mock process.kill to throw error
      process.kill = vi.fn().mockImplementation(() => {
        throw new Error("Permission denied");
      });

      // Cleanup should not throw even if killing fails
      expect(() => processManager.cleanup()).not.toThrow();
    });

    it("should try both running process and direct PID kill during cleanup", () => {
      const processes = {
        "test_process": {
          pid: 100,
          command: "test command",
          cwd: tempCwd,
          status: "running" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
      };

      // Add process to config (but not to running processes map)
      const config = processManager.getConfig();
      config.set(tempCwd, processes);

      // Mock process.kill to track calls
      const killCalls: Array<{ pid: number; signal: string | number }> = [];
      process.kill = vi.fn().mockImplementation((pid: number, signal: string | number = "SIGTERM") => {
        killCalls.push({ pid, signal });
        return true;
      });

      // Run cleanup
      processManager.cleanup();

      // Should attempt to kill by PID since it's not in running processes map
      expect(killCalls).toHaveLength(1);
      expect(killCalls[0]).toEqual({ pid: 100, signal: "SIGTERM" });
    });
  });

  describe("process lifecycle integration", () => {
    it("should properly update process status when process exits naturally", async () => {
      // This is more of an integration test that would require actual process execution
      // For now, we'll test the mechanism that handles process exit events
      
      const mockProcessData: ProcessData = {
        pid: 12345,
        command: "echo test",
        cwd: tempCwd,
        status: "running",
        startTime: Date.now(),
        autoShutdown: true,
      };

      // Simulate process stored in config
      const config = processManager.getConfig();
      const cwdProcesses = config.get(tempCwd, {});
      cwdProcesses["test_process"] = mockProcessData;
      config.set(tempCwd, cwdProcesses);

      // Simulate process no longer running
      process.kill = vi.fn().mockImplementation((pid: number, signal: string | number = 0) => {
        if (pid === 12345 && signal === 0) {
          throw new Error("ESRCH: No such process");
        }
        return originalKill(pid, signal);
      });

      // Check health to update status
      processManager.checkProcessHealth();

      // Verify status updated
      const updatedProcesses = processManager.getCurrentCwdProcesses();
      expect(updatedProcesses["test_process"].status).toBe("stopped");
    });
  });
});