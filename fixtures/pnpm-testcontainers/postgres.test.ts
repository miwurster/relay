import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { expect, it } from "vitest";

/**
 * The marker the sandbox probe greps for. Only a live query against a started
 * container can produce it, so a run that skipped the test — or matched no test
 * file at all — cannot exit green and still print this.
 */
const MARKER = "sandbox probe:";

/**
 * A container start, a published port and a real query, which is the whole
 * point: the container is a sibling on the host daemon, so its port is not on
 * this process's localhost and only `TESTCONTAINERS_HOST_OVERRIDE` gets us
 * there.
 *
 * The image tag is pinned so a registry moving `latest` cannot turn the probe
 * red on a day nobody changed anything.
 *
 * The timeout has to cover a cold pull of that image, not just the start: at
 * 180s a first run on a slow line fails on the download rather than on
 * anything this test is about.
 */
it("connects to a Postgres container published on the host daemon", { timeout: 600_000 }, async () => {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const client = new Client({ connectionString: container.getConnectionUri() });
  try {
    await client.connect();
    const { rows } = await client.query<{ version: string }>("select version()");
    const version = rows[0]?.version ?? "";
    expect(version).toContain("PostgreSQL");
    console.log(`${MARKER} ${version}`);
  } finally {
    await client.end();
    await container.stop();
  }
});
