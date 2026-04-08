FROM node:18-alpine
WORKDIR /app
COPY course-service/package.json ./package.json
RUN npm install
COPY course-service ./course-service
COPY shared ./shared
CMD ["node", "course-service/server.js"]
