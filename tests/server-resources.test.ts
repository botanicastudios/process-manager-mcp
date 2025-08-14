import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProcessManager } from "../src/process-manager.js";
import type { ProcessData } from "../src/process-manager.js";

// Mock the ProcessManager for controlled testing
vi.mock("../src/process-manager.js", () => {
  const actualModule = vi.importActual("../src/process-manager.js");
  return {
    ...actualModule,
    ProcessManager: vi.fn(),
  };
});

describe("Resource Handler Logic", () => {
  let mockProcessManager: any;

  beforeEach(() => {
    // Create mock ProcessManager
    mockProcessManager = {
      getCurrentCwdProcesses: vi.fn(),
      getProcessLogs: vi.fn(),
      cleanup: vi.fn(),
    };

    // Mock the ProcessManager constructor
    vi.mocked(ProcessManager).mockImplementation(() => mockProcessManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("processes resource handler", () => {
    // Create the handler function that would be used in the MCP server
    const processesResourceHandler = async (uri: { href: string }) => {
      const processes = mockProcessManager.getCurrentCwdProcesses();
      const processList = Object.entries(processes).map(([key, data]: [string, ProcessData]) => ({
        key,
        pid: data.pid,
        command: data.command,
        status: data.status,
        startTime: new Date(data.startTime).toISOString(),
        autoShutdown: data.autoShutdown,
        errorOutput: data.errorOutput,
        pwd: data.cwd,
      }));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(processList, null, 2),
          },
        ],
      };
    };

    it("should return empty list when no processes are running", async () => {
      mockProcessManager.getCurrentCwdProcesses.mockReturnValue({});

      const result = await processesResourceHandler({ href: "processes://processes" });

      expect(mockProcessManager.getCurrentCwdProcesses).toHaveBeenCalled();
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe("application/json");
      
      const processList = JSON.parse(result.contents[0].text!);
      expect(processList).toEqual([]);
    });

    it("should return list of running processes", async () => {
      const mockProcesses = {
        "npm run dev_1234567890": {
          pid: 12345,
          command: "npm run dev",
          cwd: "/project/path",
          status: "running" as const,
          startTime: 1640995200000, // Jan 1, 2022
          autoShutdown: true,
          logFile: "/logs/process_12345.log",
        },
        "sleep 30_1234567891": {
          pid: 12346,
          command: "sleep 30",
          cwd: "/project/path",
          status: "crashed" as const,
          startTime: 1640995260000,
          autoShutdown: false,
          logFile: "/logs/process_12346.log",
          errorOutput: "Process exited with code 1, signal: null",
        },
      };

      mockProcessManager.getCurrentCwdProcesses.mockReturnValue(mockProcesses);

      const result = await processesResourceHandler({ href: "processes://processes" });
      const processList = JSON.parse(result.contents[0].text!);

      expect(processList).toHaveLength(2);
      
      // Check first process
      expect(processList[0]).toEqual({
        key: "npm run dev_1234567890",
        pid: 12345,
        command: "npm run dev",
        status: "running",
        startTime: "2022-01-01T00:00:00.000Z",
        autoShutdown: true,
        errorOutput: undefined,
        pwd: "/project/path",
      });

      // Check second process
      expect(processList[1]).toEqual({
        key: "sleep 30_1234567891",
        pid: 12346,
        command: "sleep 30",
        status: "crashed",
        startTime: "2022-01-01T00:01:00.000Z",
        autoShutdown: false,
        errorOutput: "Process exited with code 1, signal: null",
        pwd: "/project/path",
      });
    });

    it("should handle different process statuses", async () => {
      const mockProcesses = {
        "running_process": {
          pid: 100,
          command: "running process",
          cwd: "/test",
          status: "running" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
        "stopped_process": {
          pid: 101,
          command: "stopped process",
          cwd: "/test",
          status: "stopped" as const,
          startTime: Date.now(),
          autoShutdown: true,
        },
        "crashed_process": {
          pid: 102,
          command: "crashed process",
          cwd: "/test",
          status: "crashed" as const,
          startTime: Date.now(),
          autoShutdown: true,
          errorOutput: "Segfault",
        },
      };

      mockProcessManager.getCurrentCwdProcesses.mockReturnValue(mockProcesses);

      const result = await processesResourceHandler({ href: "processes://processes" });
      const processList = JSON.parse(result.contents[0].text!);

      expect(processList).toHaveLength(3);
      expect(processList.map((p: any) => p.status)).toEqual(["running", "stopped", "crashed"]);
      expect(processList[2].errorOutput).toBe("Segfault");
      // Check that all processes have the pwd field
      expect(processList.every((p: any) => p.pwd === "/test")).toBe(true);
    });
  });

  describe("logs resource handler", () => {
    // Create the handler function that would be used in the MCP server
    const logsResourceHandler = async (uri: { href: string }, { pid }: { pid: string }) => {
      try {
        // Parse query parameters from the URI
        const url = new URL(uri.href);
        const numLines = url.searchParams.get('numLines');
        
        const logs = await mockProcessManager.getProcessLogs(Number(pid), Number(numLines) || 100);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: logs,
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `Error retrieving logs: ${error}`,
            },
          ],
        };
      }
    };

    it("should return logs for a valid process", async () => {
      const mockLogs = "Line 1\\nLine 2\\nLine 3\\nOutput complete";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      const result = await logsResourceHandler(
        { href: "processes://processes/12345/logs" }, 
        { pid: "12345" }
      );

      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 100);
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe("text/plain");
      expect(result.contents[0].text).toBe(mockLogs);
    });

    it("should respect the tail length parameter", async () => {
      const mockLogs = "Last 10 lines of logs";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      const result = await logsResourceHandler(
        { href: "processes://processes/12345/logs?numLines=10" }, 
        { pid: "12345" }
      );

      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 10);
      expect(result.contents[0].text).toBe(mockLogs);
    });

    it("should handle missing process logs", async () => {
      const noLogsMessage = "No logs available for this process";
      mockProcessManager.getProcessLogs.mockResolvedValue(noLogsMessage);

      const result = await logsResourceHandler(
        { href: "processes://processes/99999/logs" }, 
        { pid: "99999" }
      );

      expect(result.contents[0].text).toBe(noLogsMessage);
    });

    it("should handle log retrieval errors", async () => {
      const errorMessage = "Permission denied";
      mockProcessManager.getProcessLogs.mockRejectedValue(new Error(errorMessage));

      const result = await logsResourceHandler(
        { href: "processes://processes/12345/logs" }, 
        { pid: "12345" }
      );

      expect(result.contents[0].text).toContain("Error retrieving logs");
      expect(result.contents[0].text).toContain(errorMessage);
    });

    it("should default to 100 lines when numLines parameter is not provided", async () => {
      const mockLogs = "Default tail logs";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      await logsResourceHandler(
        { href: "processes://processes/12345/logs" }, 
        { pid: "12345" }
      );

      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 100);
    });

    it("should handle string PID parameter correctly", async () => {
      const mockLogs = "Process logs";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      await logsResourceHandler(
        { href: "processes://processes/12345/logs?numLines=50" }, 
        { pid: "12345" }
      );

      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 50);
    });

    it("should handle invalid numeric parameters gracefully", async () => {
      const mockLogs = "Process logs";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      await logsResourceHandler(
        { href: "processes://processes/12345/logs?numLines=invalid" }, 
        { pid: "12345" }
      );

      // Should default to 100 when numLines is invalid (NaN)
      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 100);
    });

    it("should handle different query parameter formats", async () => {
      const mockLogs = "Process logs";
      mockProcessManager.getProcessLogs.mockResolvedValue(mockLogs);

      // Test with numLines=200
      await logsResourceHandler(
        { href: "processes://processes/12345/logs?numLines=200" }, 
        { pid: "12345" }
      );
      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 200);

      // Test with empty query string
      await logsResourceHandler(
        { href: "processes://processes/12345/logs?" }, 
        { pid: "12345" }
      );
      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 100);

      // Test with other query parameters
      await logsResourceHandler(
        { href: "processes://processes/12345/logs?other=param&numLines=75" }, 
        { pid: "12345" }
      );
      expect(mockProcessManager.getProcessLogs).toHaveBeenCalledWith(12345, 75);
    });
  });

  describe("resource URI patterns", () => {
    // Create handler for testing URI patterns
    const processesHandler = async (uri: { href: string }) => {
      const processes = mockProcessManager.getCurrentCwdProcesses();
      const processList = Object.entries(processes).map(([key, data]: [string, ProcessData]) => ({
        key,
        pid: data.pid,
        command: data.command,
        status: data.status,
        startTime: new Date(data.startTime).toISOString(),
        autoShutdown: data.autoShutdown,
        errorOutput: data.errorOutput,
        pwd: data.cwd,
      }));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(processList, null, 2),
          },
        ],
      };
    };

    const logsHandler = async (uri: { href: string }, { pid, n }: { pid: string; n?: string }) => {
      const logs = await mockProcessManager.getProcessLogs(Number(pid), Number(n) || 100);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: logs,
          },
        ],
      };
    };

    it("should handle processes resource URI correctly", async () => {
      mockProcessManager.getCurrentCwdProcesses.mockReturnValue({});

      const result = await processesHandler({ href: "processes://processes" });

      expect(result.contents[0].uri).toBe("processes://processes");
    });

    it("should handle logs resource URI with parameters correctly", async () => {
      mockProcessManager.getProcessLogs.mockResolvedValue("test logs");

      const result = await logsHandler(
        { href: "processes://processes/12345/logs" }, 
        { pid: "12345", n: "25" }
      );

      expect(result.contents[0].uri).toBe("processes://processes/12345/logs");
    });
  });
});