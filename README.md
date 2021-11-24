# Stress Tester Readme

## Objective

The Airnode Stress Tester aims to test the throughput of an AWS-deployed Airnode instance. A typical Airnode AWS
deployment has a number of moving parts - ideally these parts should be tested separately such that the impact of
problematic services can be ascertained.

This document should be read in the context of the report available on Confluence:
[Airnode Stress Testing and Execution Delay Analysis](https://api3dao.atlassian.net/wiki/spaces/AIRNODE/pages/91291649/WIP+Airnode+Stress+Testing+and+Execution+Delay+Analysis)

## Components

Begin by installing the app's dependencies:
```shell
yarn install
```

### The services stack

The stress tester requires a Debian-derivative Linux target OS (in this case an EC2 instance) with docker installed and
configured for docker swarm mode. In practice this consists of:

```shell
# This is potentially dangerous - feel free to substitute if you're uncomfortable witht his approach.
curl -fsSL https://get.docker.com -o get-docker.sh
chmod +x get-docker.sh
sudo ./get-docker.sh
sudo usermod -aG docker $USER
# (log out and back in again)
docker swarm init
```

and that's that, docker swarm is ready. For the uninitiated, docker swarm in single-node mode largely behaves like
docker combined with docker-compose. For instance, `docker stack deploy -c docker-compose.yml someservice` is equivalent
to `docker-compose -f docker-compose.yml up`.

Services deployed on this swarm instance will automatically restart if they crash or if the machine is rebooted.

Two service stacks run on the machine:

- Infrastructure Services: (docker-compose.traefik.yml)
  - Traefik - A high performance load balancer and encryption provider (HTTPS). Traefik provides canonical routing and
    automatic LetsEncrypt certificate generation and renewal.
  - Postgres - A highly flexible relational SQL database - used to store test metrics. [optional]
  - Grafana - A graphing application - used to graph test metrics. [optional]
- Chain services: (docker-compose.yml)
  - Mocked EVM RPC JSON endpoint: This behaves like a HardHat or Geth endpoint, but responses are (mostly) hardcoded.
  - MITMProxy: A useful tool for inspecting HTTP(s) requests.
  - OpenEthereum in PoA single-node mode: Good for emulating a private chain as this is normally what would be used.
  - HardHat: A very fast test network simulator
  - Mocked Coingecko API: A mocked API that behaves like Coingecko. Always returns the same payload regardless of query.

You'll have to build these images, eg: `docker-compose build` You may also wish to push/pull them to a repository:
`docker-compose push/pull`

## Configuration

The EC2 instance must have this repository cloned such that it resides in `/home/ubuntu/`, eg. `/home/ubuntu/airnode`.
The EC2 instance should expose port 443 - it is safe to expose this to the public in that it is unlikely to be
exploitable.

The stress tester requires the local AWS SDK to have functional credentials. I tested with a root AWS account.

Configuration for the Stress Tester is stored in stressconfig.json in this folder.

For illustration (this is invalid JSON due to comments), the file takes this form:

```json
{
  "TestRuns": [                                             # An array of test run config options
      {
      "RequestCount": 1,                                    # The number of requests per Requester
      "WalletCount": 10,                                    # The number of Requester+Sponsor combinations deployed
      "ChainCount": 9                                       # The number of chains
    },                                                      #
    {                                                       # The above takes the form of, per run:
      "RequestCount": 2,                                    #
      "WalletCount": 10,                                    # RequestCount * WalletCount * ChainCount = Total Requests
      "ChainCount": 9
    },
    ...
  ],
  "JSONOutputConfig": {
    "Enabled": true,                                        # Should metrics be logged to a JSON file?
    "FilePath": "metrics.json"                              # The file path
  },                                                        # I''ve found an app called fx to be great for viewing JSON.
  "SsHConfig": {
  "SshKeyPath": "/home/someuser/Downloads/211101API3.pem",  # Either a path to an SSH key or "local".
                                                            # If 'local', swarm services will be directly manipulated
                                                            # otherwise the tester will log into the remote machine
                                                            # to manipulate swarm services (via SSH).
  "SshRemoteHost": "12.234.201.206",                        # unused if local
  "SshPort": 22,                                            # unused if local
  "SshUser": "ubuntu",                                      # unused if local
  "YamlPath": "/home/ubuntu/swarm/services.yml"             # path to the services YAML file on the target system
  },
  "PostgresConfig": {                                       # Postgres''s config
    "PostgresEnabled": true,
    "PostgresUser": "airnode",
    "PostgresPassword": "airnode",
    "PostgresHost": "127.0.0.1",
    "PostgresPort": 5432,
    "PostgresDatabase": "airnode"
  },
  "RandomLength": 5,                                       # The stress tester generates strings of this length as part
                                                           # of the API requests generated. This only applies to actual
                                                           # EVM implementations (HardHat and OpenEthereum).

  "TestType": "HardHatProvider",                           # HardHatProvider is the preferred provider.

                                                           # "MockedProvider" - serves static RPC responses, very fast.
                                                           # Only supports 1-100 requests, no multi-chain and no
                                                           # multi-sponsor.

                                                           # "OpenEthereumProvider" - runs OpenEthereum in "PoA" single
                                                           # node mode.
                                                           # "HardHatProvider" - runs a HardHat-based simulated network.

                                                           # "RopstenProvider"
                                                           # Tests can also be run against a *real* chain, in this case
                                                           # Ropsten (tested via Infura).
                                                           # This is similar to the test approach for the OpenEthereum
                                                           # node, but requires both a provider URL and a funded wallet
                                                           # mnemonic. These parameters are configured as
                                                           # InfuraProviderURL and MasterWalletOverrideMnemonic.
  "MasterWalletOverrideMnemonic": "long long mnemonic",
  "InfuraProviderURL": "https://ropsten.infura.io/v3/2452a362d68147c2b3d84a1b4e3bb448",
  
                                                           # InfuraProviderAirnodeOverrideURL provides an override
                                                           # parameter that is only used with the Airnode Deployer.
                                                           # This is useful if you''d like to make use of Infura's
                                                           # RPC graphs (especially to see what methods are used the
                                                           # most by Airnode).
                                                           
                                                           # This parameter is optional.
  "InfuraProviderAirnodeOverrideURL": "https://ropsten.infura.io/v3/18d2f6eedb334abb8389f67a652790ec"
}
```

## Dependencies

The stress tester's services require publicly-accessible domains for services which must be configured in the
appropriate docker-compose.yml file.

At the time of writing the Terraform Handlers did not specify memory requirements, which means Terraform would have
applied the default of 128MB. I alternated between this value at 256MB in my testing. Examples are available in
`modified-terraform-files`.

Additionally, the Terraform Lambda configuration specifies conservative/low timeouts. Ideally, for testing purposes, I'd
like to know what the ideal timeouts should be, so I collectively raised the timeouts to 50s. This requires modified
Terraform files and modifications to `airnode-node/src/constants.ts`.

## Observations (regarding Providers)

HardHat is extremely fast and in practice there are limited latency differences in RPC queries when comparing HardHat
and the fully mocked RPC endpoint. Airnode is very sensitive to query delays and therefore collocating the EC2 instance
and the Lambda Handlers is imperative.

## The Process

The stress tester application broadly runs through the following steps:

1. Remove deployed Airnode
2. Restart chain services (which also clears their state)
3. (if not using Mocked Provider) Initialise/Populate chain services (eg. deploy Airnode RRP Contract)
4. Deploy Airnode
5. Wait two minutes for at least one Airnode run
6. Collect logs from CloudWatch and extract the worst metrics from them (greatest billed duration/RAM usage)

## Graphing

I've used Grafana as the graphing system for the telemetry collected by the stress tester. I didn't feel it was
apropriate to ship Grafana's configuration files as part of this system, so I have included the SQL queries below used
to generate graphs.

#### Durations:

```sql
        SELECT
        CONCAT(request_count::text, ' | ID:', substring(test_key from 33)) as "Requests Issued",
        (metrics->3->'duration')::integer  as "startCoordinator Duration",
        (metrics->1->'duration')::integer  as "initializeProvider Duration",
        (metrics->0->'duration')::integer  as "callAPI Duration",
        (metrics->2->'duration')::integer  as "processProviderRequests Duration"
        from metrics
        WHERE success = true AND $__timeFilter(run_end)
        ORDER BY request_count ASC;
```

#### Memory Usage:

```sql
        SELECT
        CONCAT('Runs: ', request_count::text, ' | Test ID:', substring(test_key from 33)) as "Requests Issued",
        (metrics->3->'memory_usage')::integer  as "startCoordinator Duration",
        (metrics->1->'memory_usage')::integer  as "initializeProvider Duration",
        (metrics->0->'memory_usage')::integer  as "callAPI Duration",
        (metrics->2->'memory_usage')::integer  as "processProviderRequests Duration"
        from metrics
        WHERE success = true AND $__timeFilter(run_end)
        ORDER BY request_count ASC;
```

### Requests Fulfilled:

```sql
        select
        CONCAT('RC:', request_count::text, ' WC:', wallet_count::text, ' | ID:', substring(test_key from 33)) as "Requests Issued",
        (metrics->3->'duration')::integer  as "startCoordinator Duration",
        (metrics->1->'duration')::integer  as "initializeProvider Duration",
        (metrics->0->'duration')::integer  as "callAPI Duration",
        (metrics->2->'duration')::integer  as "processProviderRequests Duration"
        from metrics
        WHERE success = true AND $__timeFilter(run_end)
        ORDER BY request_count*wallet_count*chain_count ASC;
```

## Bonus

`docker-compose-ngrok.yml` contains a service stack that can be used with ngrok.io - but it expects a _basic_ nrgok
subscription, which gives the user a static subdomain. Credentials are supplied to ngrok.io as environment variables and
as such these will need to be reconfigured prior to use.
