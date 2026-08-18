FROM rust:1.88-bookworm AS build
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake g++ make pkg-config clang libclang-dev perl nasm \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates ./crates
COPY apps/local-agent ./apps/local-agent
COPY apps/desktop/src-tauri ./apps/desktop/src-tauri
COPY apps/cli ./apps/cli
COPY apps/protocol-gateway ./apps/protocol-gateway
RUN cargo build --locked --release -p apivoy-local-agent

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home apivoy
COPY --from=build /workspace/target/release/apivoy-agent /usr/local/bin/apivoy-agent
USER apivoy
VOLUME ["/var/lib/apivoy"]
EXPOSE 39217
ENTRYPOINT ["/usr/local/bin/apivoy-agent"]
