#!/bin/bash
set -e

# Create cache directories if they don't exist (on mounted PVC)
# Required for vLLM and FlashInfer to work with OpenShift arbitrary UIDs
mkdir -p /opt/app-root/src/.cache/flashinfer /opt/app-root/src/.cache/vllm

cd /app
exec node apps/backend/dist/server.js
