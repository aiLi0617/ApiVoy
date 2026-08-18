FROM rust:1.88-bookworm AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake g++ make pkg-config clang libclang-dev perl nasm \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --locked --release -p apivoy-protocol-gateway

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/apivoy-protocol-gateway /usr/local/bin/apivoy-protocol-gateway
EXPOSE 39218
ENTRYPOINT ["apivoy-protocol-gateway"]
