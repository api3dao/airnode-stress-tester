FROM node:latest

WORKDIR /app
COPY package.json /app
COPY tsconfig.json /app
COPY tslint.json /app
COPY getLogs.json /app
RUN yarn install

COPY *.ts /app/
RUN yarn build

ENTRYPOINT ["bash", "-c", "yarn start"]