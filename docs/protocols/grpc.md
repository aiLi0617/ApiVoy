# gRPC

## Workbench

Open the **gRPC** workbench for unary and streaming calls.

## Features (Experimental)

- Unary, server streaming, client streaming, and bidirectional streaming
- Metadata headers, JSON ↔ Protobuf via FileDescriptorSet
- Server reflection for descriptor discovery
- Code generation: grpcurl snippet

Execution against real gRPC servers is implemented but has **limited automated integration coverage**. Prefer testing against a local echo service before production use.

## Local echo setup

See [examples/grpc/README.md](../../examples/grpc/README.md) for a minimal proto and suggested grpcurl/grpc-server workflow.

## Verification

- Driver: `crates/driver-grpc`
- Tests: frame codec and descriptor unit tests (no full server E2E in CI yet)

Track compatibility work in GitHub Issues labeled `protocol`.
