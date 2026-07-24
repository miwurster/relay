// PROTOTYPE — spike 01. Throwaway. Do not ship.
//
// Question: does qc-catalog's Testcontainers tier run GREEN inside a sandcastle
// docker() sandbox with /var/run/docker.sock bind-mounted (docker-outside-of-
// Docker, sibling containers)?  This is the spec's #1 load-bearing risk.
//
// What this proves, end to end:
//   1. a docker() sandbox can start a SIBLING container from inside (docker CLI
//      over the mounted socket),
//   2. qc-catalog's migration-tests tier (Testcontainers + Postgres) goes green
//      in that sandbox,
//   3. UID/GID alignment does not break socket access or file ownership.
//
// Run via run.sh (one command). All state is printed as it happens.

import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const imageName = need("IMAGE_NAME");
const qcCatalog = need("QC_CATALOG");
const socketGid = Number(need("SOCKET_GID")); // gid owning the socket INSIDE the container
const branch = `spike-tc-socket-${Date.now()}`;

const rule = (s: string) => console.log(`\n===== ${s} =====`);
const line = (l: string) => process.stdout.write(l.endsWith("\n") ? l : l + "\n");

async function main() {
  rule("config");
  console.log({ imageName, qcCatalog, socketGid, branch });

  await using sandbox = await createSandbox({
    cwd: qcCatalog,
    branch,
    // sandcastle builds in a fresh git worktree, which does NOT populate
    // submodules. qc-catalog keeps generated resources (openapi-service.yaml)
    // in a submodule, so init it before the build or every context fails to
    // load. Takeaway for real relay: the sandbox must do this too.
    hooks: {
      host: {
        onWorktreeReady: [{ command: "git submodule update --init --recursive" }],
      },
    },
    sandbox: docker({
      imageName,
      // --group-add <socketGid> so the non-root agent user can read/write the
      // root-owned socket (Docker Desktop mounts it 0660 root:root).
      groups: [socketGid],
      mounts: [
        { hostPath: "/var/run/docker.sock", sandboxPath: "/var/run/docker.sock" },
        // reuse host Maven cache so the spike isn't dominated by downloads
        { hostPath: "~/.m2", sandboxPath: "/home/agent/.m2" },
      ],
      env: {
        // Sibling containers publish their mapped ports on the HOST daemon, not
        // on the sandbox container's localhost. Testcontainers must dial the
        // host — on Docker Desktop that's host.docker.internal. This is the
        // classic DOOD networking lever; if green needs it, that's a finding.
        TESTCONTAINERS_HOST_OVERRIDE: "host.docker.internal",
      },
    }),
  });

  rule("preflight: can we talk to the daemon + start a sibling?");
  const whoami = await sandbox.exec("id", { onLine: line });
  const dockerVersion = await sandbox.exec("docker version --format '{{.Server.Version}}'", { onLine: line });
  const sibling = await sandbox.exec("docker run --rm hello-world 2>&1 | tail -3", { onLine: line });
  console.log({
    id: whoami.exitCode,
    dockerServer: dockerVersion.exitCode,
    siblingStart: sibling.exitCode,
  });
  if (dockerVersion.exitCode !== 0 || sibling.exitCode !== 0) {
    throw new Error("PREFLIGHT FAILED: socket unreachable or cannot start sibling container");
  }

  rule("file ownership sanity (bind-mounted worktree)");
  await sandbox.exec("ls -ln pom.xml && stat -c '%u:%g %n' pom.xml", { onLine: line });

  rule("build deps (skip their tests — isolate migration-tests as the target)");
  const build = await sandbox.exec(
    "./mvnw -pl migration-tests -am -q -Dcheckstyle.skip=true -DskipTests install",
    { onLine: line },
  );
  if (build.exitCode !== 0) throw new Error("dependency build failed — not the socket question");

  rule("run ONLY migration-tests (Testcontainers Postgres)");
  const t0 = Date.now();
  const tests = await sandbox.exec(
    "./mvnw -pl migration-tests -q -Dcheckstyle.skip=true test",
    { onLine: line },
  );
  const secs = Math.round((Date.now() - t0) / 1000);

  rule("VERDICT");
  console.log({ testsExitCode: tests.exitCode, seconds: secs });
  if (tests.exitCode === 0) {
    console.log("GREEN — Testcontainers ran to a real green result inside the sandbox.");
  } else {
    console.log("RED — see log above. Capture the failure mode + pivot in FINDINGS.md.");
  }
  process.exitCode = tests.exitCode === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\nSPIKE ERROR:", e);
  process.exitCode = 2;
});
