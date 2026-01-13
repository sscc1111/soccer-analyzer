// Test setup file for Firebase Rules testing
// This file runs before all tests

// Ensure cleanup happens if tests are interrupted
process.on('SIGINT', () => {
  process.exit(1);
});

process.on('SIGTERM', () => {
  process.exit(1);
});
