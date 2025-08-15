#!/bin/bash

echo "Process Manager MCP - CLI Demo"
echo "=============================="
echo ""

# Show help
echo "1. Showing help:"
npx @botanicastudios/process-manager-mcp --help
echo ""

# List processes (should be empty)
echo "2. Listing processes (initially empty):"
npx @botanicastudios/process-manager-mcp list
echo ""

# Start a persistent process
echo "3. Starting a persistent background process:"
npx @botanicastudios/process-manager-mcp start --persist "while true; do echo 'Background task running...'; sleep 5; done"
echo ""

# Get the PID from the last command (this is just for demo purposes)
# In real usage, you'd get this from the output
PID=$(npx @botanicastudios/process-manager-mcp list | grep "PID:" | head -1 | awk '{print $2}')

# List processes again
echo "4. Listing processes (should show the background process):"
npx @botanicastudios/process-manager-mcp list
echo ""

# Show logs
echo "5. Viewing logs for process $PID:"
npx @botanicastudios/process-manager-mcp logs -n 5 $PID
echo ""

# Stop the process
echo "6. Stopping process $PID:"
npx @botanicastudios/process-manager-mcp stop $PID
echo ""

# List processes again (should be empty)
echo "7. Listing processes (should be empty again):"
npx @botanicastudios/process-manager-mcp list
echo ""

echo "Demo complete!"