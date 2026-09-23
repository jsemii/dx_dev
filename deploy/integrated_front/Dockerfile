FROM node:20.19-alpine AS build

WORKDIR /app/back/local_frontend

COPY back/local_frontend/package.json ./
COPY back/local_frontend/package-lock.json ./

RUN npm ci

WORKDIR /app

COPY back/local_frontend ./back/local_frontend
COPY frontend/frontend ./frontend/frontend

WORKDIR /app/back/local_frontend

RUN npm run build


FROM nginx:alpine

COPY deploy/integrated_front/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build \
    /app/back/local_frontend/dist \
    /usr/share/nginx/html

EXPOSE 80