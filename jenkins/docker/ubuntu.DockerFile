FROM ubuntu:24.04

CMD ["/bin/bash"]
ENV DEBIAN_FRONTEND=noninteractive
MAINTAINER Catapult Development Team

RUN apt-get -y update

RUN apt-get -y install --reinstall pkg-config cmake-data

RUN  apt-get install -y bison gdb git \
    flex python3 python3-ply python3-pip \
    shellcheck inotify-tools libdw-dev \
    libtraceevent-dev \
    libelf-dev libiberty-dev libslang2-dev && \
    rm -rf /var/lib/apt/lists/*

RUN  pip3 install --break-system-packages -U colorama cryptography \
    gitpython pycodestyle pylint pylint-quotes PyYAML

RUN git clone https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git linux.git && \
    cd linux.git/tools/perf && \
    make && \
    cp perf /usr/bin && \
    cd ../../.. && \
    rm -rf linux.git
