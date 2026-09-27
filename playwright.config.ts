import { defineConfig } from "@playwright/test";

// Layout checks for the desktop app's CSS, rendered in a real browser. No app
// server: each test builds a page from src/desktop.css and the component's markup.
export default defineConfig({
  testDir: "tests",
  use: { ...(process.env.CI ? {} : { channel: "chrome" }) },
  reporter: process.env.CI ? "github" : "list",
});
