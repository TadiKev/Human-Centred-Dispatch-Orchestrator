# frontend/Dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package manifests first for caching
COPY package*.json ./

# Use npm ci for reproducible installs (ensure package-lock.json present)
RUN npm ci --silent

# Copy the rest of the frontend files
COPY . .

# Expose the dev port (your docker-compose already maps 3000:3000)
EXPOSE 3000

# Default command (docker-compose overrides command with ["npm","run","dev"])
CMD ["npm", "run", "dev"]
