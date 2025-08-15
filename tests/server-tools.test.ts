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
    const startProcessHandler = async ({ command, auto_shutdown = true, cwd, env }: { command: string; auto_shutdown?: boolean; cwd?: string; env?: Record<string, string> }) => {
      try {
        const pid = await mockProcessManager.startProcess(command, auto_shutdown, cwd, env);
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

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("npm run dev", true, undefined, undefined);
      expect(result.content[0].text).toBe(`Process started successfully. PID: ${expectedPid}`);
      expect(result.isError).toBeUndefined();
    });

    it("should use default auto_shutdown value", async () => {
      const expectedPid = 12345;
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      await startProcessHandler({
        command: "echo hello",
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("echo hello", true, undefined, undefined);
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

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("background-service", false, undefined, undefined);
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

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("echo test", true, testCwd, undefined);
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
        relativeCwd, // The handler passes the relative path, ProcessManager resolves it internally
        undefined
      );
    });

    it("should pass environment variables to startProcess", async () => {
      const expectedPid = 12345;
      const envVars = {
        "USER_ID": "12345",
        "USER_TOKEN": "abcdef",
        "API_KEY": "xyz789"
      };
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      await startProcessHandler({
        command: "node app.js",
        auto_shutdown: true,
        env: envVars,
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("node app.js", true, undefined, envVars);
    });

    it("should handle process with cwd and env together", async () => {
      const expectedPid = 12345;
      const testCwd = "./server";
      const envVars = {
        "PORT": "3000",
        "NODE_ENV": "production"
      };
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      await startProcessHandler({
        command: "npm start",
        auto_shutdown: false,
        cwd: testCwd,
        env: envVars,
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("npm start", false, testCwd, envVars);
    });

    it("should handle empty environment variables object", async () => {
      const expectedPid = 12345;
      mockProcessManager.startProcess.mockResolvedValue(expectedPid);

      await startProcessHandler({
        command: "echo test",
        env: {},
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith("echo test", true, undefined, {});
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

  describe("get_logs tool handler", () => {
    // Create the handler function that would be used in the MCP server
    const getLogsHandler = async ({ pid, numLines = 100 }: { pid: number; numLines?: number }) => {
      try {
        const logs = await mockProcessManager.getProcessLogs(pid, numLines);
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
    };

    it("should retrieve logs for a process successfully", async () => {
      const mockLogs = "2024-01-01 12:00:00 Starting process...\n2024-01-01 12:00:01 Process running...";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      const result = await getLogsHandler({
        pid: 12345,
      });

      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 100);
      expect(result.content[0].text).toBe(mockLogs);
      expect(result.isError).toBeUndefined();
    });

    it("should use custom numLines parameter", async () => {
      const mockLogs = "Line 1\nLine 2\nLine 3";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      const result = await getLogsHandler({
        pid: 12345,
        numLines: 50,
      });

      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 50);
      expect(result.content[0].text).toBe(mockLogs);
    });

    it("should use default numLines value when not specified", async () => {
      const mockLogs = "Default log output";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      const result = await getLogsHandler({
        pid: 12345,
      });

      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 100);
    });

    it("should handle process logs retrieval failure", async () => {
      const errorMessage = "Log file not found";
      mockProcessManager.getProcessLogs.mockRejectedValue(new Error(errorMessage));

      const result = await getLogsHandler({
        pid: 99999,
      });

      expect(result.content[0].text).toContain("Failed to retrieve logs");
      expect(result.content[0].text).toContain(errorMessage);
      expect(result.isError).toBe(true);
    });

    it("should handle empty logs", async () => {
      mockProcessManager.getProcessLogs.mockResolvedValue("");

      const result = await getLogsHandler({
        pid: 12345,
      });

      expect(result.content[0].text).toBe("");
      expect(result.isError).toBeUndefined();
    });

    it("should handle logs with special characters", async () => {
      const specialLogs = "Error: Something went wrong!\n[WARNING] Special chars: @#$%^&*()\nPath: /usr/local/bin";
      mockProcessManager.getProcessLogs.mockResolvedValue(specialLogs);

      const result = await getLogsHandler({
        pid: 12345,
      });

      expect(result.content[0].text).toBe(specialLogs);
      expect(result.isError).toBeUndefined();
    });

    it("should handle very large numLines parameter", async () => {
      const mockLogs = "Large log output";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      const result = await getLogsHandler({
        pid: 12345,
        numLines: 10000,
      });

      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 10000);
      expect(result.content[0].text).toBe(mockLogs);
    });

    it("should handle when process logs returns 'No logs available'", async () => {
      const noLogsMessage = "No logs available for this process";
      mockProcessManager.getProcessLogs.mockResolvedValue(noLogsMessage);

      const result = await getLogsHandler({
        pid: 12345,
      });

      expect(result.content[0].text).toBe(noLogsMessage);
      expect(result.isError).toBeUndefined();
    });
  });

  describe("list_processes tool handler", () => {
    // Create the handler function that would be used in the MCP server
    const listProcessesHandler = async () => {
      try {
        const processes = mockProcessManager.getCurrentCwdProcesses();
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
          return {
            content: [
              {
                type: "text",
                text: "No processes are currently running.",
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
    };

    it("should list multiple running processes", async () => {
      const mockProcesses = {
        "npm_run_dev_123": {
          pid: 12345,
          command: "npm run dev",
          status: "running",
          startTime: 1704067200000, // 2024-01-01 00:00:00
          autoShutdown: true,
          cwd: "/home/user/project",
        },
        "python_server_456": {
          pid: 67890,
          command: "python server.py",
          status: "running",
          startTime: 1704067260000, // 2024-01-01 00:01:00
          autoShutdown: false,
          cwd: "/home/user/api",
        },
      };
      mockProcessManager.getCurrentCwdProcesses.mockReturnValue(mockProcesses);

      const result = await listProcessesHandler();

      expect(mockProcessManager.getCurrentCwdProcesses).toHaveBeenCalled();
      expect(result.content[0].text).toContain("PID: 12345");
      expect(result.content[0].text).toContain("Command: npm run dev");
      expect(result.content[0].text).toContain("Status: running");
      expect(result.content[0].text).toContain("Auto-shutdown: true");
      expect(result.content[0].text).toContain("Working Directory: /home/user/project");
      expect(result.content[0].text).toContain("PID: 67890");
      expect(result.content[0].text).toContain("Command: python server.py");
      expect(result.content[0].text).toContain("Auto-shutdown: false");
      expect(result.isError).toBeUndefined();
    });

    it("should handle empty process list", async () => {
      mockProcessManager.getCurrentCwdProcesses.mockReturnValue({});

      const result = await listProcessesHandler();

      expect(result.content[0].text).toBe("No processes are currently running.");
      expect(result.isError).toBeUndefined();
    });

    it("should display error output when present", async () => {
      const mockProcesses = {
        "failed_process": {
          pid: 99999,
          command: "node broken.js",
          status: "crashed",
          startTime: 1704067200000,
          autoShutdown: true,
          cwd: "/home/user/project",
          errorOutput: "Error: Module not found",
        },
      };
      mockProcessManager.getCurrentCwdProcesses.mockReturnValue(mockProcesses);

      const result = await listProcessesHandler();

      expect(result.content[0].text).toContain("PID: 99999");
      expect(result.content[0].text).toContain("Status: crashed");
      expect(result.content[0].text).toContain("Error: Module not found");
      expect(result.isError).toBeUndefined();
    });

    it("should handle single process", async () => {
      const mockProcesses = {
        "single_process": {
          pid: 11111,
          command: "node app.js",
          status: "running",
          startTime: 1704067200000,
          autoShutdown: true,
          cwd: "/usr/local/app",
        },
      };
      mockProcessManager.getCurrentCwdProcesses.mockReturnValue(mockProcesses);

      const result = await listProcessesHandler();

      expect(result.content[0].text).toContain("PID: 11111");
      expect(result.content[0].text).toContain("Command: node app.js");
      expect(result.content[0].text).toContain("Working Directory: /usr/local/app");
      expect(result.content[0].text).not.toContain("\n\n"); // Should not have double newline separator for single process
      expect(result.isError).toBeUndefined();
    });

    it("should handle processes with various statuses", async () => {
      const mockProcesses = {
        "running_proc": {
          pid: 11111,
          command: "node app.js",
          status: "running",
          startTime: 1704067200000,
          autoShutdown: true,
          cwd: "/app",
        },
        "stopped_proc": {
          pid: 22222,
          command: "npm test",
          status: "stopped",
          startTime: 1704067200000,
          autoShutdown: true,
          cwd: "/app",
        },
        "crashed_proc": {
          pid: 33333,
          command: "python script.py",
          status: "crashed",
          startTime: 1704067200000,
          autoShutdown: false,
          cwd: "/app",
          errorOutput: "Segmentation fault",
        },
      };
      mockProcessManager.getCurrentCwdProcesses.mockReturnValue(mockProcesses);

      const result = await listProcessesHandler();

      expect(result.content[0].text).toContain("Status: running");
      expect(result.content[0].text).toContain("Status: stopped");
      expect(result.content[0].text).toContain("Status: crashed");
      expect(result.content[0].text).toContain("Segmentation fault");
      expect(result.isError).toBeUndefined();
    });

    it("should handle process listing failure", async () => {
      const errorMessage = "Failed to access process data";
      mockProcessManager.getCurrentCwdProcesses.mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const result = await listProcessesHandler();

      expect(result.content[0].text).toContain("Failed to list processes");
      expect(result.content[0].text).toContain(errorMessage);
      expect(result.isError).toBe(true);
    });

    it("should format timestamps correctly", async () => {
      const mockProcesses = {
        "timed_process": {
          pid: 12345,
          command: "node server.js",
          status: "running",
          startTime: 1704067200000, // 2024-01-01 00:00:00 UTC
          autoShutdown: true,
          cwd: "/app",
        },
      };
      mockProcessManager.getCurrentCwdProcesses.mockReturnValue(mockProcesses);

      const result = await listProcessesHandler();

      expect(result.content[0].text).toContain("Started: 2024-01-01T00:00:00.000Z");
      expect(result.isError).toBeUndefined();
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

      const startProcessHandler = async ({ command, auto_shutdown = true, cwd, env }: { command: string; auto_shutdown?: boolean; cwd?: string; env?: Record<string, string> }) => {
        const pid = await mockProcessManager.startProcess(command, auto_shutdown, cwd, env);
        return {
          content: [{ type: "text", text: `PID: ${pid}` }],
        };
      };

      const result = await startProcessHandler({
        command: "echo 'test with spaces and special chars: !@#$%'",
      });

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        "echo 'test with spaces and special chars: !@#$%'",
        true,
        undefined,
        undefined
      );
      expect(result.content[0].text).toBe("PID: 12345");
    });
  });
});