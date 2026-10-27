# Yapper: AI Discord bot + web dashboard.
#   docker build -t yapper .
#   docker build -t yapper --build-arg WITH_AI_CLIS=true .   # adds the Claude, ChatGPT (Codex) and Gemini CLIs for "sign in" mode
FROM node:22-bookworm-slim

ARG WITH_AI_CLIS=false

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

RUN if [ "$WITH_AI_CLIS" = "true" ]; then npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli && npm cache clean --force; fi

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

# Settings and the admin password live here: mount a volume.
ENV STORAGE_DIR=/data \
    WEB_PORT=3080 \
    WEB_HOST=0.0.0.0 \
    NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||3080)+'/api/session').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/main.js"]
