/*
 * Tests for MCP Server Mode
 * 
 * Validates that the MCP server mode still functions correctly
 * after adding CLI support
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import path from "path";
import os from "os";
import { mkdirSync, rmSync, existsSync } from "fs";

describe("MCP Server Mode", () => {
  let testDir: string;
  let serverPath: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `mcp-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    // Path to the server
    serverPath = path.join(process.cwd(), "dist", "index.js");
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should start as MCP server when no arguments provided", async () => {
    // Start the server and send a test message
    const serverProcess = execa("node", [serverPath], {
      cwd: testDir,
      env: { ...process.env, CWD: testDir },
    });

    // Send initialization message
    const initMessage = JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      },
      id: 1
    });

    serverProcess.stdin!.write(initMessage + "\n");

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 500));

    // Kill the server
    serverProcess.kill("SIGTERM");

    // Check that we got a valid MCP response
    const output = await serverProcess.catch(e => e);
    
    // The server should have responded with JSON-RPC messages
    // We check for the presence of JSON-RPC format in stdout
    expect(output.stdout).toContain("jsonrpc");
    expect(output.stdout).toContain("2.0");
  });

  it("should not start as MCP server when CLI command is provided", async () => {
    // Try to run with --help flag
    const result = await execa("node", [serverPath, "--help"], {
      cwd: testDir,
    });

    // Should show CLI help, not start MCP server
    expect(result.stdout).toContain("Process Manager MCP");
    expect(result.stdout).toContain("start [options] <command...>");
    expect(result.stdout).not.toContain("jsonrpc");
    expect(result.exitCode).toBe(0);
  });

  it("should not start as MCP server when 'list' command is provided", async () => {
    const result = await execa("node", [serverPath, "list"], {
      cwd: testDir,
      env: { ...process.env, CWD: testDir },
    });

    // Should show process list, not start MCP server
    expect(result.stdout).toContain("No processes are currently running");
    expect(result.stdout).not.toContain("jsonrpc");
    expect(result.exitCode).toBe(0);
  });
});