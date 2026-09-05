FROM ubuntu:22.04

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY . /workspace

CMD ["bash", "-lc", "cmake -S backend -B backend/build && cmake --build backend/build --target position_test && ctest --test-dir backend/build --output-on-failure"]
