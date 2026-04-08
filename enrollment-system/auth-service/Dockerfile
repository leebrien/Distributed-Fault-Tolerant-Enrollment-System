FROM node:18-alpine
WORKDIR /app
COPY auth-service/package.json ./package.json
RUN npm install
COPY auth-service ./auth-service
COPY shared ./shared
CMD ["node", "auth-service/server.js"]
