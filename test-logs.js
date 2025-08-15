const fs = require('fs');

// Create test content
const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10\n";

// Original implementation
const lines1 = content.split("\n");
console.log("Original:", JSON.stringify(lines1.slice(-5)));

// Fixed implementation
const lines2 = content.split("\n").filter(line => line !== "");
console.log("Fixed:", JSON.stringify(lines2.slice(-5)));

// What we actually want
console.log("Expected: ['Line 6', 'Line 7', 'Line 8', 'Line 9', 'Line 10']");