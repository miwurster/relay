import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DEFAULT_DOCKERFILE_PATH, type RelayConfig } from "../config.js";
import { type DockerRunner, runDocker } from "./docker-host.js";
import { ConfigError } from "../errors.js";

/** The tag relay builds a repo's sandbox image under when it builds one. */
export function sandboxImageName(repoRoot: string): string {
  return `relay-sandbox:${basename(repoRoot)}`;
}

/**
 * The absolute path of the repo's sandbox Dockerfile.
 *
 * Never the repo root: the sandbox recipe is relay's concern living in the
 * repo, not the repo's own application image.
 */
export function resolveDockerfile(repoRoot: string, configured: string): string {
  const root = resolve(repoRoot);
  const path = resolve(root, configured);
  if (!path.startsWith(`${root}/`)) {
    throw new ConfigError(
      `The sandbox dockerfile must live inside the repo, but ${configured} resolves to ${path}.`,
    );
  }
  if (dirname(path) === root) {
    throw new ConfigError(
      `The sandbox dockerfile may not sit at the repo root (${configured}); ` +
        `put it in a subdirectory, e.g. ${DEFAULT_DOCKERFILE_PATH}.`,
    );
  }
  if (!existsSync(path)) {
    throw new ConfigError(`No sandbox dockerfile at ${path}`);
  }
  return path;
}

export interface ResolveSandboxImageOptions {
  repoRoot: string;
  config: RelayConfig;
  docker?: DockerRunner;
  /** The host UID/GID the image's agent user must match. */
  uid?: number;
  gid?: number;
}

/**
 * The image the sandbox runs, prebuilt-ref-wins: a configured `image` is used
 * as is, otherwise relay builds the repo's dockerfile.
 *
 * A built image bakes the host UID/GID so bind-mounted files keep their
 * ownership and sandcastle's image-UID preflight passes.
 */
export async function resolveSandboxImage({
  repoRoot,
  config,
  docker = runDocker,
  uid = hostUid(),
  gid = hostGid(),
}: ResolveSandboxImageOptions): Promise<string> {
  if (config.image) return config.image;

  const dockerfile = resolveDockerfile(repoRoot, config.dockerfile);
  const imageName = sandboxImageName(repoRoot);
  await docker([
    "build",
    "--build-arg",
    `AGENT_UID=${uid}`,
    "--build-arg",
    `AGENT_GID=${gid}`,
    "--tag",
    imageName,
    "--file",
    dockerfile,
    repoRoot,
  ]);
  return imageName;
}

/** Where a prebuilt image ref was proven to be real. */
export type ImageSource = "host" | "registry";

/**
 * Prove a prebuilt image ref is real, on the host or in its registry.
 *
 * `resolveSandboxImage` takes a configured ref on trust, which is right for a
 * run — docker pulls it when the sandbox starts — but a preflight that reports
 * an image nobody can pull as resolvable is worth nothing.
 */
export async function verifyPrebuiltImage({
  image,
  docker = runDocker,
}: {
  image: string;
  docker?: DockerRunner;
}): Promise<ImageSource> {
  try {
    await docker(["image", "inspect", "--format", "{{.Id}}", image]);
    return "host";
  } catch {
    // Not pulled yet, so ask the registry — without pulling the whole image.
    await docker(["manifest", "inspect", image]);
    return "registry";
  }
}

function hostUid(): number {
  return process.getuid?.() ?? 1000;
}

function hostGid(): number {
  return process.getgid?.() ?? 1000;
}
