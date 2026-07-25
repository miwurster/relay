import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SandboxError } from "./errors.js";

/** The docker socket, mounted into the sandbox so the green gate can use it. */
export const DOCKER_SOCKET_PATH = "/var/run/docker.sock";

/** Runs the docker CLI on the host and returns its trimmed stdout. */
export type DockerRunner = (args: readonly string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

/** The real docker CLI. Every docker failure surfaces as a `SandboxError`. */
export const runDocker: DockerRunner = async (args) => {
  try {
    const { stdout } = await execFileAsync("docker", [...args], { maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new SandboxError(`docker ${args.join(" ")} failed: ${reason}`);
  }
};

/**
 * The group that owns the docker socket **as seen inside a container**, which
 * is not the host's group id.
 *
 * The sandbox user is non-root and the socket is group-readable only, so this
 * gid is what `--group-add` needs. Detected per host, never hardcoded — Docker
 * Desktop and a Linux daemon disagree.
 */
export async function detectDockerSocketGid({
  image,
  docker = runDocker,
}: {
  image: string;
  docker?: DockerRunner;
}): Promise<number> {
  const output = await docker([
    "run",
    "--rm",
    "--user",
    "0",
    "--volume",
    `${DOCKER_SOCKET_PATH}:${DOCKER_SOCKET_PATH}`,
    // The sandbox image's entrypoint idles the container; override it to read
    // the socket's group and exit.
    "--entrypoint",
    "stat",
    image,
    "--format",
    "%g",
    DOCKER_SOCKET_PATH,
  ]);

  const gid = output.trim();
  if (!/^\d+$/.test(gid)) {
    throw new SandboxError(
      `Could not read the group of ${DOCKER_SOCKET_PATH} inside a container: ${output}`,
    );
  }
  return Number(gid);
}

/**
 * The daemon's version as read from inside the sandbox image **by the image's
 * own non-root user**, with the socket's group added the way a pass adds it.
 *
 * A socket that merely exists proves nothing: the sandbox user is non-root, so
 * only a real round trip to the daemon under that user shows the green gate's
 * Testcontainers tier will reach it.
 */
export async function dockerDaemonVersionInSandbox({
  image,
  docker = runDocker,
}: {
  image: string;
  docker?: DockerRunner;
}): Promise<string> {
  const socketGid = await detectDockerSocketGid({ image, docker });
  const version = await docker([
    "run",
    "--rm",
    "--group-add",
    String(socketGid),
    "--volume",
    `${DOCKER_SOCKET_PATH}:${DOCKER_SOCKET_PATH}`,
    "--entrypoint",
    "docker",
    image,
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);

  if (!version) {
    throw new SandboxError(
      "The docker daemon answered with no version, so the sandbox user cannot be " +
        `shown to reach it through ${DOCKER_SOCKET_PATH}.`,
    );
  }
  return version;
}

/**
 * The host address Testcontainers must dial from inside the sandbox.
 *
 * Sibling containers publish their ports on the host daemon rather than on the
 * sandbox's localhost (docker-outside-of-Docker), so Testcontainers needs
 * `TESTCONTAINERS_HOST_OVERRIDE`. Docker Desktop offers a host alias; a Linux
 * daemon does not, so the bridge network's gateway stands in — proven on Docker
 * Desktop (spike 01), still to be verified against a Linux daemon.
 */
export async function resolveTestcontainersHost({
  platform = process.platform,
  docker = runDocker,
}: {
  platform?: NodeJS.Platform;
  docker?: DockerRunner;
} = {}): Promise<string> {
  if (platform === "darwin") return "host.docker.internal";

  const gateway = await docker([
    "network",
    "inspect",
    "bridge",
    "--format",
    "{{(index .IPAM.Config 0).Gateway}}",
  ]);
  if (!gateway.trim()) {
    throw new SandboxError(
      "Could not resolve the docker bridge gateway, so Testcontainers inside the " +
        "sandbox would not reach ports published on the host daemon.",
    );
  }
  return gateway.trim();
}
