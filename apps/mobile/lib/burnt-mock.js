/**
 * Mock burnt module for Expo Go compatibility
 * This is used when the native burnt module is not available
 */

const toast = (options) => {
  console.log(`[Toast] ${options.title}${options.message ? `: ${options.message}` : ""}`);
};

const alert = (options) => {
  console.log(`[Alert] ${options.title}${options.message ? `: ${options.message}` : ""}`);
};

module.exports = {
  toast,
  alert,
};
