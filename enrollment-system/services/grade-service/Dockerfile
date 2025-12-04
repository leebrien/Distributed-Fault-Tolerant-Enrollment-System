FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy proto files
COPY ../../proto /app/proto

# Copy service code
COPY . .

# Expose REST and gRPC ports
EXPOSE 4004 5004

CMD ["npm", "start"]
