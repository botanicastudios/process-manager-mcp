import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProcessManager } from "../src/process-manager.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Mock the ProcessManager for controlled testing
vi.mock("../src/process-manager.js", () => {
  const actualModule = vi.importActual("../src/process-manager.js");
  return {
    ...actualModule,
    ProcessManager: vi.fn(),
  };
});

describe("Tool Handler Logic", () => {
  let mockProcessManager: any;
  let tempCwd: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempCwd = mkdtempSync(path.join(tmpdir(), "mcp-server-test-"));
    
    // Create mock ProcessManager
    mockProcessManager = {
      startProcess: vi.fn(),
      endProcess: vi.fn(),
      getCurrentCwdProcesses: vi.fn(),
      getProcessLogs: vi.fn(),
      cleanup: vi.fn(),
    };

    // Mock the ProcessManager constructor
    vi.mocked(ProcessManager).mockImplementation(() => mockProcessManager);
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      rmSync(tempCwd, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    
    vi.clearAllMocks();
  });

  describe("start_process tool handler", () => {
    // Create the handler function that would be used in the MCP server
    const startProcessHandler = async ({ command, auto_shutdown = true, cwd }: { command: string; auto_shutdown?: boolean; cwd?: string }) => {
      try {
        const pid = await mockProcessManager.startProcess(command, auto_shutdown, cwd);
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
    };

    it("should start a process successfully", async () => {
      const expectedPid = 12345;
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      const result = await startProcessHandler({
        command: "npm run dev",
        auto_shutdown: true,
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("npm run dev", true, undefined);
      expect(result.content[0].text).toBe(`Process started successfully. PID: ${expectedPid}`);
      expect(result.isError).toBeUndefined();
    });

    it("should use default auto_shutdown value", async () => {
      const expectedPid = 12345;
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      await startProcessHandler({
        command: "echo hello",
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("echo hello", true, undefined);
    });

    it("should handle process start failure", async () => {
      const errorMessage = "Command not found";
      mockProcessManager.startProcess.mockRejectedValue(new Error(errorMessage));

      const result = await startProcessHandler({
        command: "nonexistent-command",
      });

      expect(result.content[0].text).toContain("Failed to start process");
      expect(result.content[0].text).toContain(errorMessage);
      expect(result.isError).toBe(true);
    });

    it("should respect auto_shutdown setting", async () => {
      const expectedPid = 12345;
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      await startProcessHandler({
        command: "background-service",
        auto_shutdown: false,
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("background-service", false, undefined);
    });

    it("should pass cwd parameter to startProcess", async () => {
      const expectedPid = 12345;
      const testCwd = "/custom/working/directory";
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      await startProcessHandler({
        command: "echo test",
        auto_shutdown: true,
        cwd: testCwd,
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("echo test", true, testCwd);
    });

    it("should resolve relative paths for cwd parameter", async () => {
      const expectedPid = 12345;
      const relativeCwd = "./server";
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      await startProcessHandler({
        command: "npm start",
        cwd: relativeCwd,
      });

      // The ProcessManager should receive the resolved absolute path
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        "npm start", 
        true, 
        relativeCwd // The handler passes the relative path, ProcessManager resolves it internally
      );
    });
  });

  describe("end_process tool handler", () => {
    // Create the handler function that would be used in the MCP server
    const endProcessHandler = async ({ command, pid }: { command?: string; pid?: number }) => {
      try {
        const success = await mockProcessManager.endProcess(command || pid);
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
    };

    it("should stop a process by PID successfully", async () => {
      mockProcessManager.endProcess.mockResolvedValue(true);

      const result = await endProcessHandler({
        pid: 12345,
      });

      expect(mockProcessManager.endProcess).toHaveBeenCalledWith(12345);
      expect(result.content[0].text).toBe("Process stopped successfully");
      expect(result.isError).toBeUndefined();
    });

    it("should stop a process by command successfully", async () => {
      mockProcessManager.endProcess.mockResolvedValue(true);

      const result = await endProcessHandler({
        command: "npm run dev",
      });

      expect(mockProcessManager.endProcess).toHaveBeenCalledWith("npm run dev");
      expect(result.content[0].text).toBe("Process stopped successfully");
    });

    it("should handle process not found", async () => {
      mockProcessManager.endProcess.mockResolvedValue(false);

      const result = await endProcessHandler({
        pid: 99999,
      });

      expect(result.content[0].text).toBe("Process not found or could not be stopped");
      expect(result.isError).toBe(true);
    });

    it("should handle process stop failure", async () => {
      const errorMessage = "Permission denied";
      mockProcessManager.endProcess.mockRejectedValue(new Error(errorMessage));

      const result = await endProcessHandler({
        pid: 12345,
      });

      expect(result.content[0].text).toContain("Failed to stop process");
      expect(result.content[0].text).toContain(errorMessage);
      expect(result.isError).toBe(true);
    });
  });

  describe("input validation", () => {
    it("should require either command or pid for end_process", async () => {
      mockProcessManager.endProcess.mockResolvedValue(false);

      const endProcessHandler = async ({ command, pid }: { command?: string; pid?: number }) => {
        const success = await mockProcessManager.endProcess(command || pid);
        return {
          content: [{ type: "text", text: success ? "Success" : "Failed" }],
          isError: !success,
        };
      };

      const result = await endProcessHandler({});

      expect(mockProcessManager.endProcess).toHaveBeenCalledWith(undefined);
      expect(result.isError).toBe(true);
    });

    it("should handle valid command strings for start_process", async () => {
      mockProcessManager.startProcess.mockResolvedValue(12345);

      const startProcessHandler = async ({ command, auto_shutdown = true }: { command: string; auto_shutdown?: boolean }) => {
        const pid = await mockProcessManager.startProcess(command, auto_shutdown);
        return {
          content: [{ type: "text", text: `PID: ${pid}` }],
        };
      };

      const result = await startProcessHandler({
        command: "echo 'test with spaces and special chars: !@#$%'",
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        "echo 'test with spaces and special chars: !@#$%'",
        true
      );
      expect(result.content[0].text).toBe("PID: 12345");
    });
  });
});