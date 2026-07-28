FROM maven:3-eclipse-temurin-21

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git-all \
    unzip \
    ca-certificates \
    jq \
    sudo \
    && rm -rf /var/lib/apt/lists/*

ARG AGENT_UID=1000
ARG AGENT_GID=1000
ARG GH_VERSION=2.96.0

RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL -o /tmp/gh.deb \
        "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.deb" \
    && dpkg -i /tmp/gh.deb \
    && rm /tmp/gh.deb \
    && gh --version

RUN install -m 0755 -d /etc/apt/keyrings \
    && . /etc/os-release \
    && curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
        -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# The base image often already holds the host's uid (node:lts owns 1000) or its
# gid (macOS "staff", 20), so make room before claiming them for the agent.
RUN taken="$(getent passwd "${AGENT_UID}" | cut -d: -f1)" \
    && if [ -n "${taken}" ]; then userdel "${taken}"; fi \
    && if ! getent group "${AGENT_GID}" >/dev/null; then groupadd -g "${AGENT_GID}" agent; fi \
    && useradd --create-home --uid "${AGENT_UID}" --gid "${AGENT_GID}" --shell /bin/bash agent \
    && echo 'agent ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/agent \
    && chmod 0440 /etc/sudoers.d/agent

USER ${AGENT_UID}:${AGENT_GID}
ENV PATH="/home/agent/.local/bin:${PATH}"

RUN curl -fsSL https://claude.ai/install.sh | bash \
    && claude --version

WORKDIR /home/agent
ENTRYPOINT ["sleep", "infinity"]
