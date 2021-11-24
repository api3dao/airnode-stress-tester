FROM ubuntu:21.04

RUN apt update && apt install -y unzip wget
WORKDIR /bin
RUN wget https://github.com/openethereum/openethereum/releases/download/v3.3.0-rc.13/openethereum-linux-v3.3.0-rc.13.zip
RUN unzip openethereum-linux-v3.3.0-rc.13.zip

WORKDIR /
RUN mkdir -p /parity-config-data
RUN mkdir -p /parity-data/keys/DemoPoA

COPY key.json /parity-data/keys/DemoPoA/UTC--2021-10-21T19-44-40.000Z--io16xyz66dyc055q8r3wrx9qxjjs0a3lmfq8ha97k.json
COPY config.toml /parity-config-data/
COPY password /parity-config-data/
COPY spec.json /parity-config-data/

ENTRYPOINT ["/bin/openethereum", "-c", "/parity-config-data/config.toml"]
