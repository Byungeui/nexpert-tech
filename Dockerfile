# 멀티스테이지가 아니다 — 빌드 단계가 없는 순수 Node 앱이라 나눌 게 없다.
FROM node:22-alpine

WORKDIR /app

# package 파일만 먼저 복사해 npm ci 레이어를 캐시한다.
# 소스만 고친 배포에서는 이 레이어가 재사용돼 빌드가 빨라진다.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# root로 돌리지 않는다. node 이미지에 이미 있는 비특권 사용자를 쓴다.
USER node

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
