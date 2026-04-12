FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install

# Copy project files
COPY . .

# Build the frontend
RUN bun run build

# Expose the Elysia port
EXPOSE 42069

# Set production environment
ENV NODE_ENV=production

# Start the server
CMD ["bun", "run", "src/server/index.ts"]>>>>>>> REPLACE
