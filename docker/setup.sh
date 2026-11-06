# The Docker daemon, installed when the image has no docker and started when nothing answers.
if ! docker info >/dev/null 2>&1; then
  if ! command -v docker >/dev/null; then
    echo 'squidci: this image has no docker; installing it'
    squidci_docker_apt docker ca-certificates curl
    squidci_docker_os=$(. /etc/os-release && echo "$ID")
    squidci_docker_codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL --retry 5 --retry-delay 2 "https://download.docker.com/linux/$squidci_docker_os/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$squidci_docker_os $squidci_docker_codename stable" > /etc/apt/sources.list.d/docker.list
    DEBIAN_FRONTEND=noninteractive apt-get update -q
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin
    unset squidci_docker_os squidci_docker_codename
  fi
  squidci_docker_mirror /etc/docker/daemon.json
  echo 'squidci: starting dockerd'
  dockerd >/var/log/squidci-dockerd.log 2>&1 &
  for squidci_docker_wait in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  unset squidci_docker_wait
  if ! docker info >/dev/null 2>&1; then
    echo 'squidci: dockerd did not come up within a minute; its log follows' >&2
    tail -n 50 /var/log/squidci-dockerd.log >&2
    return 1
  fi
fi
