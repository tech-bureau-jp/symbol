# --- Builder stage ---
FROM ubuntu:24.04 AS builder

# 必要なパッケージインストール
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    flex \
    bison \
    libelf-dev \
    libssl-dev \
    zlib1g-dev \
    libdw-dev \
    libiberty-dev \
    libnuma-dev \
    libslang2-dev \
    perl \
    libperl-dev \
    systemtap-sdt-dev \
    python3 \
    python3-dev \
    python-is-python3 \
    rsync \
    bc \
    kmod \
    cpio \
    && rm -rf /var/lib/apt/lists/*

# カーネルソースをクローン
WORKDIR /usr/src
RUN git clone https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git

# ビルド
WORKDIR /usr/src/linux
RUN ARCH=$(uname -m | sed -e 's/x86_64/x86_64/' -e 's/aarch64/arm64/') \
    && echo "Detected architecture: $ARCH" \
    && make ARCH=$ARCH headers_install \
    && cd /usr/src/linux/tools/perf \
    && EXTRA_CFLAGS="-I/usr/src/linux/arch/$ARCH/include/generated/uapi" \
    NO_LIBTRACEEVENT=1 NO_JEVENTS=1 make ARCH=$ARCH -j$(nproc)

# --- Final stage ---
FROM ubuntu:24.04

# 必要最小限だけ
RUN apt-get update && apt-get install -y \
    libelf1 \
    libssl3 \
    zlib1g \
    libdw1 \
    libnuma1 \
    libslang2 \
    perl \
    python3 \
    python3-dev \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

# builderからperfバイナリをコピー
COPY --from=builder /usr/src/linux/tools/perf/perf /usr/bin/perf

# デフォルトコマンド
CMD ["bash"]