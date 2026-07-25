# Reference sandbox recipe — copy this into a target repo as docker/relay.Dockerfile.
#
# relay builds it with `--build-arg AGENT_UID/AGENT_GID` set to the host's, so
# bind-mounted files keep their ownership and sandcastle's image-UID preflight
# passes. Skills, the Atlassian MCP config and the docker socket are mounted at
# runtime and must never be baked in.
#
# A repo owning its own recipe should keep it at CI parity — this file only
# guarantees the tooling relay itself needs.
FROM eclipse-temurin:21-jdk

ARG AGENT_UID=1000
ARG AGENT_GID=1000
ARG NODE_MAJOR=22
ARG GLAB_VERSION=1.109.0

# docker-ce-cli only: the daemon is the host's, reached over the mounted socket
# (docker-outside-of-Docker), which is what the Testcontainers tier needs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl git gnupg maven ripgrep unzip \
    && install -m 0755 -d /etc/apt/keyrings \
    && . /etc/os-release \
    && curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
        -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list \
    && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL -o /tmp/glab.deb \
        "https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/${GLAB_VERSION}/glab_${GLAB_VERSION}_linux_${arch}.deb" \
    && dpkg -i /tmp/glab.deb \
    && rm /tmp/glab.deb \
    && glab --version

# The agent user carries the host's UID/GID. GID 20 (macOS "staff") and other
# low GIDs often already exist in the base image, so reuse the group if present.
RUN if ! getent group "${AGENT_GID}" >/dev/null; then groupadd -g "${AGENT_GID}" agent; fi \
    && useradd -m -u "${AGENT_UID}" -g "${AGENT_GID}" -s /bin/bash agent

USER ${AGENT_UID}:${AGENT_GID}
ENV PATH="/home/agent/.local/bin:${PATH}"

# The native claude install, per user: it lands in the agent's home directory.
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && claude --version

WORKDIR /home/agent
ENTRYPOINT ["sleep", "infinity"]
