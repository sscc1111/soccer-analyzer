export function safeId(input: string) {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_");
}
