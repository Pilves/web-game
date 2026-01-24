FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY server/ ./server/
COPY client/ ./client/
COPY shared/ ./shared/

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "server/index.js"]
