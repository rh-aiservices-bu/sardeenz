# Sardeenz Container Build
# Usage: make build VERSION=x.y.z

IMAGE_REGISTRY := quay.io/rh-aiservices-bu
IMAGE_NAME := sardeenz
CONTAINERFILE := docker/Containerfile

# Default version (can be overridden)
VERSION ?= latest

# Full image tag
IMAGE_TAG := $(IMAGE_REGISTRY)/$(IMAGE_NAME):$(VERSION)

# Cluster simulator defaults (override with make dev\:cluster\:sim PODS=3 GPUS=4)
PODS ?= 2
GPUS ?= 2
SIM_GPU_MEMORY ?= 24
SIM_STARTUP ?= 3s
BASE_PORT ?= 3001

.PHONY: build push help dev\:cluster\:sim

## build: Build the container image (usage: make build VERSION=x.y.z)
build:
ifndef VERSION
	$(error VERSION is required. Usage: make build VERSION=x.y.z)
endif
	podman build -t $(IMAGE_TAG) -f $(CONTAINERFILE) .
	@echo "Built: $(IMAGE_TAG)"

## push: Push the container image to registry
push:
	podman push $(IMAGE_TAG)
	@echo "Pushed: $(IMAGE_TAG)"

## build-push: Build and push in one step
build-push: build push

## dev:cluster:sim: Launch a simulated multi-pod cluster (GPU-free)
##   Usage: make dev:cluster:sim [PODS=2] [GPUS=2] [SIM_GPU_MEMORY=24] [BASE_PORT=3001]
dev\:cluster\:sim:
	@command -v llm-d-inference-sim >/dev/null 2>&1 || { echo "Error: llm-d-inference-sim not found in PATH"; exit 1; }
	@PEERS=""; NAMES=""; COLORS=""; CMDS=""; \
	for i in $$(seq 0 $$(($(PODS)-1))); do \
		[ -n "$$PEERS" ] && PEERS="$$PEERS,"; \
		PEERS="$${PEERS}localhost:$$(($(BASE_PORT)+i))"; \
	done; \
	SECRET=$${CLUSTER_SECRET:-$$(openssl rand -hex 32)}; \
	for i in $$(seq 0 $$(($(PODS)-1))); do \
		PORT=$$(($(BASE_PORT)+i)); \
		CMDS="$$CMDS \"PORT=$$PORT INFERENCE_BACKEND=inference-sim DEV_VIRTUAL_GPU_COUNT=$(GPUS) SIM_GPU_MEMORY_GB=$(SIM_GPU_MEMORY) SIM_STARTUP_DURATION=$(SIM_STARTUP) CLUSTER_PEERS=$$PEERS CLUSTER_SECRET=$$SECRET npm run dev -w apps/backend\""; \
		[ -n "$$NAMES" ] && NAMES="$$NAMES,"; \
		NAMES="$${NAMES}pod-$$i"; \
		[ -n "$$COLORS" ] && COLORS="$$COLORS,"; \
		COLORS="$${COLORS}blue"; \
	done; \
	CMDS="$$CMDS \"VITE_BACKEND_URL=http://localhost:$(BASE_PORT) npm run dev -w apps/frontend\""; \
	NAMES="$$NAMES,frontend"; \
	COLORS="$$COLORS,green"; \
	echo "Starting $(PODS)-pod cluster ($(GPUS) GPUs × $(SIM_GPU_MEMORY) GB each)"; \
	echo "Peers: $$PEERS"; \
	echo "Frontend: http://localhost:5173"; \
	eval npx concurrently -k -n "$$NAMES" -c "$$COLORS" $$CMDS

## help: Show this help
help:
	@echo "Sardeenz"
	@echo ""
	@echo "Container:"
	@echo "  make build VERSION=x.y.z       Build container image"
	@echo "  make push VERSION=x.y.z        Push to quay.io"
	@echo "  make build-push VERSION=x.y.z  Build and push"
	@echo ""
	@echo "Development:"
	@echo "  make dev:cluster:sim           Launch 2-pod simulated cluster (GPU-free)"
	@echo "    PODS=N                         Number of pods (default: 2)"
	@echo "    GPUS=N                         GPUs per pod (default: 2)"
	@echo "    SIM_GPU_MEMORY=N               GB per GPU (default: 24)"
	@echo "    BASE_PORT=N                    First pod port (default: 3001)"
	@echo "    CLUSTER_SECRET=xxx             Shared secret (default: auto-generated)"
	@echo ""
	@echo "Image: $(IMAGE_REGISTRY)/$(IMAGE_NAME):<VERSION>"
