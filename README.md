# Process Manager MCP Server

A Model Context Protocol (MCP) server that provides process management capabilities with persistent storage and log management.

## ⚠️ Security Warning

**This MCP server allows AI agents to execute arbitrary commands on your machine.** This poses significant security risks including:

- Execution of malicious commands
- Access to sensitive files and system resources
- Potential system compromise
- Data theft or destruction

**Strongly recommended security measures:**

- **Run agents in containerized environments** (Docker, Podman, etc.) with limited privileges
- **Never run this server with elevated privileges** (root/Administrator)
- **Use in isolated development environments only**
- **Regularly audit process logs for suspicious activity**
- **Consider using read-only filesystem mounts where possible**

Use at your own risk. The authors are not responsible for any damage caused by misuse of this software.

## Features

- **Start Processes**: Launch processes with configurable auto-shutdown behavior and custom working directories
- **Stop Processes**: Stop processes by command name or PID
- **Process Monitoring**: Automatic health checks every 5 seconds
- **Persistent Storage**: Process information persists across server restarts
- **Log Management**: Capture and retrieve process logs with tail functionality
- **Directory-based Organization**: Organize processes by working directory using the `CWD` environment variable
- **Flexible Path Support**: Support for both absolute and relative paths in the `cwd` parameter

## Installation

### Claude Code

```
claude mcp add process-manager -s user -- npx -y @botanicastudios/process-manager-mcp
```

### Into an MCP server config file

```
{
  "mcpServers": {
    "process-manager": {
      "command": "npx",
      "args": ["-y", "@botanicastudios/process-manager-mcp"],
      "env": {
        "CWD": "/Users/me/Code/myproject"
      }
    }
  }
}
```

`env.CWD` is optional

## Configuration

Set the `CWD` environment variable to specify the working directory for process management:

```bash
export CWD=/path/to/your/project
npx -y process-manager-mcp
```

If `CWD` is not set, the current working directory will be used.

## Tools

### start_process

Start a new process with the given command.

**Parameters:**

- `command` (string, required): The command to execute
- `auto_shutdown` (boolean, optional, default: true): Whether to automatically shutdown the process when the MCP server stops
- `cwd` (string, optional): Working directory for the process. Supports relative paths like `'./server'` or `'server'` (relative to `${process.env.CWD || process.cwd()}`)

**Returns:** Process PID as an integer

**Examples:**

```json
{
  "command": "npm run dev",
  "auto_shutdown": false
}
```

```json
{
  "command": "python app.py",
  "auto_shutdown": true,
  "cwd": "./backend"
}
```

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Process started successfully. PID: 12345"
    }
  ]
}
```

### end_process

Stop a running process by PID.

**Parameters:**

- `pid` (number, required): The PID of the process to stop

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Process stopped successfully"
    }
  ]
}
```

Or on error:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Process not found or could not be stopped"
    }
  ],
  "isError": true
}
```

## Resources

### processes://processes

Lists all tracked running processes for the current working directory.

**Returns:** JSON array with process information including:

- `key`: Internal process key
- `pid`: Process ID
- `command`: Original command
- `status`: Current status (running, stopped, crashed)
- `startTime`: ISO timestamp of when the process started
- `autoShutdown`: Whether the process will be shut down with the server
- `errorOutput`: Error information if the process crashed
- `pwd`: Absolute path to the directory where the command was executed (e.g., `/Users/user/project`)

### processes://processes/{pid}/logs?numLines={tail_length}

Retrieve logs for a specific process.

**Parameters:**

- `pid`: Process ID (required in the URL path)
- `numLines` (optional query parameter, default: 100): Number of lines to tail from the end of the log

**Returns:** Process logs as plain text

**Example:** `processes://processes/12345/logs?numLines=50`

## Process Management

### Auto-shutdown vs Persistent Processes

- **Auto-shutdown processes** (`auto_shutdown: true`): These processes are automatically terminated when the MCP server shuts down. Useful for development servers and temporary processes.

- **Persistent processes** (`auto_shutdown: false`): These processes continue running even after the MCP server stops. Useful for background services and long-running tasks.

### Process Monitoring

The server automatically monitors all tracked processes every 5 seconds:

- **Running**: Process is active and responding
- **Stopped**: Process ended normally or was terminated
- **Crashed**: Process ended with a non-zero exit code

### Log Storage

Process logs are stored in `~/.process-manager-mcp/logs/` and are organized by PID. Logs persist even when the MCP server is not running, allowing you to retrieve logs from previously started processes.

## Usage Examples

### Starting a Development Server

```json
{
  "tool": "start_process",
  "parameters": {
    "command": "npm run dev",
    "auto_shutdown": true
  }
}
```

### Starting a Background Service

```json
{
  "tool": "start_process",
  "parameters": {
    "command": "python background_worker.py",
    "auto_shutdown": false
  }
}
```

### Starting a Process in a Specific Directory

```json
{
  "tool": "start_process",
  "parameters": {
    "command": "npm start",
    "auto_shutdown": true,
    "cwd": "./frontend"
  }
}
```

This will run `npm start` in the `./frontend` directory relative to the current working directory.

### Stopping a Process by PID

```json
{
  "tool": "end_process",
  "parameters": {
    "pid": 12345
  }
}
```

### Viewing Process Logs

Access the resource `processes://processes/12345/logs?numLines=50` to get the last 50 lines of logs for process with PID 12345.

## Development

### Building from Source

```bash
git clone <repository>
cd process-manager-mcp
npm install
npm run build
```

### Running in Development Mode

```bash
npm run dev
```

## License

MIT
