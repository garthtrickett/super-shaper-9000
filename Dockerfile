# File: Dockerfile
# ===================================

# Use the official Bun image
FROM oven/bun:latest

# Set the working directory
WORKDIR /app

# Copy package.json and the lockfile for dependency installation
# This step is cached unless package.json or bun.lock changes
COPY package.json ./
COPY bun.lock ./

# Install dependencies. The --frozen-lockfile flag ensures it uses the exact versions from bun.lock
RUN bun install --frozen-lockfile

# Copy the rest of your application code
# This layer is invalidated more frequently, but dependencies are already installed.
COPY . .

# Install Rust and WASM tools to compile surfer-core
RUN apt-get update && apt-get install -y curl build-essential pkg-config libssl-dev \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup target add wasm32-unknown-unknown \
    && cargo install wasm-bindgen-cli

# Build the Vite/Lit frontend for production
RUN bun run build

# Expose the port your Elysia app will run on
EXPOSE 42069

# Set the production environment variable
ENV NODE_ENV=production

# The command to start the server
CMD ["bun", "run", "src/server/index.ts"]
