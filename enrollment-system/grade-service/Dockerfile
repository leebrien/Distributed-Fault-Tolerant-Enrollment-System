FROM node:18-alpine
WORKDIR /app
COPY grade-service/package.json ./package.json
RUN npm install
COPY grade-service ./grade-service
COPY shared ./shared
CMD ["node", "grade-service/server.js"]
