#!/usr/bin/env node
import { runCli } from "./cli.js";
import { runDoctor } from "./doctor.js";
import { runPass } from "./pass.js";

const code = await runCli(process.argv.slice(2), { runPass, runDoctor });
process.exit(code);
