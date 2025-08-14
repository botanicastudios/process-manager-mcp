import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProcessManager } from "../src/process-manager.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Helper function to wait for a condition
function waitFor(condition: () => boolean, timeout = 5000, interval = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Condition not met within ${timeout}ms`));
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

describe("Integration Tests", () => {
  let tempCwd: string;

  beforeEach(() => {
    tempCwd = mkdtempSync(path.join(tmpdir(), "integration-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempCwd, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("End-to-end process management", () => {
    it("should complete a full process lifecycle", async () => {
      const processManager = new ProcessManager(tempCwd, `integration-test-${Date.now()}`);

      try {
        // Start a short-lived process
        const pid = await processManager.startProcess("echo 'Integration test complete'", true);
        expect(typeof pid).toBe("number");

        // Verify process is stored
        let processes = processManager.getCurrentCwdProcesses();
        expect(Object.keys(processes)).toHaveLength(1);
        
        const processData = Object.values(processes)[0];
        expect(processData.pid).toBe(pid);
        expect(processData.command).toBe("echo 'Integration test complete'");
        expect(processData.status).toBe("running");
        expect(processData.autoShutdown).toBe(true);

        // Wait for process to complete and status to update
        await waitFor(() => {
          processManager.checkProcessHealth();
          const processes = processManager.getCurrentCwdProcesses();
          const process = Object.values(processes)[0];
          return process && process.status === "stopped";
        }, 5000);

        // Verify process status updated
        processes = processManager.getCurrentCwdProcesses();
        const updatedProcess = Object.values(processes)[0];
        expect(updatedProcess.status).toBe("stopped");

        // Give a moment for logs to be written
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify logs are available
        const logs = await processManager.getProcessLogs(pid, 10);
        expect(logs).toContain("Integration test complete");

      } finally {
        processManager.cleanup();
      }
    }, 15000);

    it("should handle multiple processes in the same directory", async () => {
      const processManager = new ProcessManager(tempCwd, `multi-process-test-${Date.now()}`);

      try {
        // Start multiple longer-running processes so we can test ending them
        const pid1 = await processManager.startProcess("sleep 2", true);
        const pid2 = await processManager.startProcess("sleep 3", false);
        
        expect(pid1).not.toBe(pid2);

        // Give processes a moment to start
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify both processes are stored
        const processes = processManager.getCurrentCwdProcesses();
        expect(Object.keys(processes)).toHaveLength(2);

        const pids = Object.values(processes).map(p => p.pid);
        expect(pids).toContain(pid1);
        expect(pids).toContain(pid2);

        // Verify different auto-shutdown settings
        const process1 = Object.values(processes).find(p => p.pid === pid1);
        const process2 = Object.values(processes).find(p => p.pid === pid2);
        
        expect(process1?.autoShutdown).toBe(true);
        expect(process2?.autoShutdown).toBe(false);

        // End processes while they're still running
        const success1 = await processManager.endProcess(pid1);
        const success2 = await processManager.endProcess(pid2);
        
        expect(success1).toBe(true);
        expect(success2).toBe(true);

      } finally {
        processManager.cleanup();
      }
    }, 15000);

    it("should persist process data across ProcessManager instances", async () => {
      const configName = `persistence-test-${Date.now()}`;
      let pid: number;
      let pm1: ProcessManager;
      let pm2: ProcessManager;

      try {
        // First instance - start a long-running process
        pm1 = new ProcessManager(tempCwd, configName);
        pid = await pm1.startProcess("sleep 5", false); // Shorter sleep, non-auto-shutdown
        expect(typeof pid).toBe("number");
        
        // Let the process start
        await new Promise(resolve => setTimeout(resolve, 100));
        pm1.cleanup(); // This should not kill the non-auto-shutdown process

        // Second instance - should see the persisted process
        pm2 = new ProcessManager(tempCwd, configName);
        const processes = pm2.getCurrentCwdProcesses();
        expect(Object.keys(processes)).toHaveLength(1);
        
        const persistedProcess = Object.values(processes)[0];
        expect(persistedProcess.pid).toBe(pid);
        expect(persistedProcess.command).toBe("sleep 5");
        expect(persistedProcess.autoShutdown).toBe(false);

        // Clean up the persisted process
        const success = await pm2.endProcess(pid);
        expect(success).toBe(true);
      } finally {
        // Ensure cleanup happens
        try {
          if (pm1!) pm1.cleanup();
        } catch (e) { /* ignore */ }
        try {
          if (pm2!) pm2.cleanup();
        } catch (e) { /* ignore */ }
        
        // Force kill the process if it's still running
        try {
          if (pid!) {
            process.kill(pid, 'SIGKILL');
          }
        } catch (e) { /* process might already be dead */ }
      }
    }, 15000);

    it("should handle processes that fail after starting", async () => {
      const processManager = new ProcessManager(tempCwd, `error-test-${Date.now()}`);

      try {
        // Start a process that will fail quickly with a clear error
        const pid = await processManager.startProcess("false", true); // 'false' command always exits with code 1
        expect(typeof pid).toBe("number");

        // Process should be initially stored
        let processes = processManager.getCurrentCwdProcesses();
        expect(Object.keys(processes)).toHaveLength(1);

        // Wait for it to fail and check status
        await waitFor(() => {
          processManager.checkProcessHealth();
          const updatedProcesses = processManager.getCurrentCwdProcesses();
          const process = Object.values(updatedProcesses)[0];
          return process && (process.status === "stopped" || process.status === "crashed");
        }, 3000);

        processes = processManager.getCurrentCwdProcesses();
        const process = Object.values(processes)[0];
        expect(["stopped", "crashed"]).toContain(process.status);

      } finally {
        processManager.cleanup();
      }
    });

    it("should differentiate processes by working directory", async () => {
      const tempCwd1 = mkdtempSync(path.join(tmpdir(), "integration-cwd1-"));
      const tempCwd2 = mkdtempSync(path.join(tmpdir(), "integration-cwd2-"));
      
      const configName = `cwd-test-${Date.now()}`;
      const pm1 = new ProcessManager(tempCwd1, configName);
      const pm2 = new ProcessManager(tempCwd2, configName);

      try {
        // Start processes in different directories
        const pid1 = await pm1.startProcess("echo 'Directory 1'", true);
        const pid2 = await pm2.startProcess("echo 'Directory 2'", true);

        // Each ProcessManager should only see its own processes
        const processes1 = pm1.getCurrentCwdProcesses();
        const processes2 = pm2.getCurrentCwdProcesses();

        expect(Object.keys(processes1)).toHaveLength(1);
        expect(Object.keys(processes2)).toHaveLength(1);

        expect(Object.values(processes1)[0].pid).toBe(pid1);
        expect(Object.values(processes2)[0].pid).toBe(pid2);

        expect(Object.values(processes1)[0].cwd).toBe(tempCwd1);
        expect(Object.values(processes2)[0].cwd).toBe(tempCwd2);

      } finally {
        pm1.cleanup();
        pm2.cleanup();
        
        // Clean up temp directories
        try {
          rmSync(tempCwd1, { recursive: true, force: true });
          rmSync(tempCwd2, { recursive: true, force: true });
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }, 15000);
  });

  describe("Module imports", () => {
    it("should be able to import ProcessManager without errors", () => {
      expect(ProcessManager).toBeDefined();
      expect(typeof ProcessManager).toBe("function");
    });

    it("should be able to create ProcessManager instance", () => {
      const pm = new ProcessManager(tempCwd, `import-test-${Date.now()}`);
      expect(pm).toBeInstanceOf(ProcessManager);
      expect(pm.getCurrentCwd()).toBe(tempCwd);
      pm.cleanup();
    });
  });
});