#!/usr/bin/env bash
set -euo pipefail
# Runners already provide the client. Avoid upgrading the host MySQL service
# while a test service container owns the same port.
if ! command -v mysql >/dev/null 2>&1 || ! command -v mysqldump >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends mysql-client
fi
mysql --version
mysqldump --version
