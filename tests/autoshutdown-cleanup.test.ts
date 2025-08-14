/*
 * Auto-shutdown cleanup tests
 * 
 * Tests the cleanup behavior for processes with autoShutdown enabled,
 * ensuring they are properly removed from config on server shutdown
 * and cleaned up on startup if they are stale.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProcessManager } from "../src/process-manager.js";
import Conf from "conf";

describe("AutoShutdown Cleanup", () => {
  let manager: ProcessManager;

  beforeEach(() => {
    // Use a test-specific config to avoid conflicts
    manager = new ProcessManager(process.cwd(), "test-autoshutdown");
  });

  afterEach(() => {
    // Clean up
    manager.cleanup();
  });

  it("should remove autoShutdown processes from config on cleanup", async () => {
    // Start a process with autoShutdown
    const pid = await manager.startProcess("sleep 30", true);
    
    // Verify process is in config
    const processesBefore = manager.getCurrentCwdProcesses();
    const foundBefore = Object.values(processesBefore).some(p => p.pid === pid);
    expect(foundBefore).toBe(true);
    
    // Call cleanup
    manager.cleanup();
    
    // Verify autoShutdown process is removed from config
    const processesAfter = manager.getCurrentCwdProcesses();
    const foundAfter = Object.values(processesAfter).some(p => p.pid === pid);
    expect(foundAfter).toBe(false);
  });

  it("should keep non-autoShutdown processes in config on cleanup", async () => {
    // Start a process without autoShutdown
    const pid = await manager.startProcess("sleep 30", false);
    
    // Verify process is in config
    const processesBefore = manager.getCurrentCwdProcesses();
    const foundBefore = Object.values(processesBefore).some(p => p.pid === pid);
    expect(foundBefore).toBe(true);
    
    // Call cleanup
    manager.cleanup();
    
    // Verify non-autoShutdown process is still in config
    const processesAfter = manager.getCurrentCwdProcesses();
    const foundAfter = Object.values(processesAfter).some(p => p.pid === pid);
    expect(foundAfter).toBe(true);
    
    // Clean up the process manually
    await manager.endProcess(pid);
  });

  it("should clean up stale autoShutdown processes on startup", async () => {
    // Create a fake stale process entry directly in config
    const config = new Conf<any>({
      projectName: "process-manager-mcp",
      configName: "test-autoshutdown-stale",
    });
    
    const stalePid = 999999; // Non-existent PID
    const staleProcessKey = `stale_process_${Date.now()}`;
    const cwd = process.cwd();
    
    config.set(cwd, {
      [staleProcessKey]: {
        pid: stalePid,
        command: "fake_command",
        cwd: cwd,
        status: "running",
        startTime: Date.now(),
        autoShutdown: true,
      }
    });
    
    // Create a new manager with the same config
    const newManager = new ProcessManager(cwd, "test-autoshutdown-stale");
    
    // Verify the stale autoShutdown process was cleaned up
    const processes = newManager.getCurrentCwdProcesses();
    const found = Object.values(processes).some(p => p.pid === stalePid);
    expect(found).toBe(false);
    
    newManager.cleanup();
  });

  it("should not clean up stale non-autoShutdown processes on startup", async () => {
    // Create a fake stale process entry directly in config
    const config = new Conf<any>({
      projectName: "process-manager-mcp",
      configName: "test-autoshutdown-persist",
    });
    
    const stalePid = 999998; // Non-existent PID
    const staleProcessKey = `stale_process_${Date.now()}`;
    const cwd = process.cwd();
    
    config.set(cwd, {
      [staleProcessKey]: {
        pid: stalePid,
        command: "fake_command",
        cwd: cwd,
        status: "stopped",
        startTime: Date.now(),
        autoShutdown: false,
      }
    });
    
    // Create a new manager with the same config
    const newManager = new ProcessManager(cwd, "test-autoshutdown-persist");
    
    // Verify the non-autoShutdown process was NOT cleaned up
    const processes = newManager.getCurrentCwdProcesses();
    const found = Object.values(processes).some(p => p.pid === stalePid);
    expect(found).toBe(true);
    
    // Clean up
    const processKey = Object.keys(processes).find(key => processes[key].pid === stalePid);
    if (processKey) {
      const cwdConfig = config.get(cwd, {});
      delete cwdConfig[processKey];
      config.set(cwd, cwdConfig);
    }
    
    newManager.cleanup();
  });
});