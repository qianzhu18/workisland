#!/usr/bin/env node
"use strict";

const pid = Number(process.argv[2]);
if (!Number.isInteger(pid) || pid <= 0) process.exit(2);

function isAlive() {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

const timer = setInterval(() => {
  if (isAlive()) return;
  clearInterval(timer);
  process.stdout.write("exited\n", () => process.exit(0));
}, 250);

process.on("SIGTERM", () => {
  clearInterval(timer);
  process.exit(0);
});
