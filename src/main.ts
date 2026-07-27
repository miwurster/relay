#!/usr/bin/env node
import { runCli } from "./cli.js";
import { runDoctor } from "./doctor/doctor.js";
import { runInit } from "./init/init.js";
import { runPass } from "./pass/pass.js";

const code = await runCli(process.argv.slice(2), { runPass, runDoctor, runInit });
process.exit(code);
