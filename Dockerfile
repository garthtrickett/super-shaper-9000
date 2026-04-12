# Use the official Bun image
FROM oven/bun:latest

# Set the working directory
WORKDIR /app

# Copy package.json and the lockfile for dependency installation
# This step is cached unless package.json or bun.lockb changes
COPY package.json ./
COPY bun.lockb ./

# Install dependencies. The --frozen-lockfile flag ensures it uses the exact versions from bun.lockb
RUN bun install --frozen-lockfile

# Copy the rest of your application code
# This layer is invalidated more frequently, but dependencies are already installed.
COPY . .

# Build the Vite/Lit frontend for production
RUN bun run build

# Expose the port your Elysia app will run on
EXPOSE 42069

# Set the production environment variable
ENV NODE_ENV=production

# The command to start the server
CMD ["bun", "run", "src/server/index.ts"]
