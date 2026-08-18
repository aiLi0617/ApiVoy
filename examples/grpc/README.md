# gRPC example

ApiVoy gRPC support is **Experimental**. Use a local test server for development.

## Minimal proto (`echo.proto`)

```protobuf
syntax = "proto3";
package echo;

service Echo {
  rpc SayHello (HelloRequest) returns (HelloReply);
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
```

## Suggested local server

Run any gRPC echo server that implements the service above, for example with [grpcurl](https://github.com/fullstorydev/grpcurl) and your preferred language toolchain.

In ApiVoy gRPC workbench:

- Target: `localhost:50051` (adjust to your server)
- Service: `echo.Echo`
- Method: `SayHello`
- Message JSON: `{ "name": "ApiVoy" }`

Import a FileDescriptorSet generated from `echo.proto` or enable server reflection if your server supports it.

## grpcurl equivalent

```bash
grpcurl -plaintext -d '{"name":"ApiVoy"}' localhost:50051 echo.Echo/SayHello
```

No credentials or production endpoints are included in this example.
