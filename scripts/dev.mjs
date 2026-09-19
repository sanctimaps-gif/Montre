#!/usr/bin/env node
/**
 * Lance l'API et le front ensemble, avec les journaux prefixes par service.
 * Le coeur metier est compile en premier : le serveur et le front l'importent
 * depuis son dossier dist.
 */
import { spawn } from "node:child_process";

const processes = [];

function run(name, color, command, args) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  const prefix = `\u001b[${color}m[${name}]\u001b[0m`;
  const forward = (stream, target) => {
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) target.write(`${prefix} ${line}\n`);
      }
    });
  };

  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix} arrete avec le code ${code}`);
      stopAll(code);
    }
  });

  processes.push(child);
  return child;
}

function stopAll(code = 0) {
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const build = spawn("npm", ["run", "build", "-w", "@montre/core"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

build.on("exit", (code) => {
  if (code !== 0) {
    console.error("La compilation de @montre/core a echoue.");
    process.exit(code ?? 1);
  }
  run("api", "33", "npm", ["run", "start", "-w", "@montre/server"]);
  run("web", "36", "npm", ["run", "dev", "-w", "@montre/web"]);
});
