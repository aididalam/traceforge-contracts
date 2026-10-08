# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22.23.3-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY hardhat.config.ts ./
COPY contracts ./contracts
RUN npm run compile && npm prune --omit=dev
FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/artifacts/contracts/TraceForge.sol/TraceForge.json ./contract.json
COPY package.json ./
COPY scripts/bootstrap.mjs ./scripts/bootstrap.mjs
RUN chmod -R a+rX /app
USER node
CMD ["node", "scripts/bootstrap.mjs"]
