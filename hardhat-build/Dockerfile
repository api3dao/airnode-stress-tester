FROM node:latest

WORKDIR /root
RUN npm init --yes
RUN npm install --save hardhat

COPY integration-info.json /root/
COPY hardhat.config.ts /root/

RUN npm install --save-dev typescript
RUN npm install --save-dev ts-node
RUN npm install --save-dev @nomiclabs/hardhat-waffle 'ethereum-waffle@^3.0.0' @nomiclabs/hardhat-ethers 'ethers@^5.0.0'
