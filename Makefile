# Sardeenz Container Build
# Usage: make build VERSION=x.y.z

IMAGE_REGISTRY := quay.io/rh-aiservices-bu
IMAGE_NAME := sardeenz
CONTAINERFILE := docker/Containerfile

# Default version (can be overridden)
VERSION ?= latest

# Full image tag
IMAGE_TAG := $(IMAGE_REGISTRY)/$(IMAGE_NAME):$(VERSION)

# Helm chart configuration
CHART_DIR := deploy/helm/sardeenz
# Chart name from Chart.yaml — also the packaged .tgz prefix and OCI repo name.
CHART_NAME := sardeenz-chart
# OCI push target (the org). `helm push` appends the chart name (sardeenz-chart),
# so the artifact lands at quay.io/rh-aiservices-bu/sardeenz-chart:<version>.
CHART_OCI_REPO := oci://$(IMAGE_REGISTRY)
# Directory packaged .tgz artifacts are written to
CHART_PACKAGE_DIR := dist/charts
# Chart/app version — sourced from package.json so the chart stays in lockstep
# with the application (override with `make helm-package VERSION=x.y.z`).
APP_VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)
CHART_VERSION ?= $(APP_VERSION)

# Cluster simulator defaults (override with make dev\:cluster\:sim PODS=3 GPUS=4)
PODS ?= 2
GPUS ?= 2
SIM_GPU_MEMORY ?= 24
SIM_STARTUP ?= 3s
BASE_PORT ?= 3001

.PHONY: build push help dev\:cluster\:sim \
	helm-lint helm-template helm-package helm-push helm-package-push

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

## helm-lint: Lint the Helm chart
helm-lint:
	helm lint $(CHART_DIR)

## helm-template: Render the chart to stdout (usage: make helm-template [ARGS="--set ..."])
helm-template:
	helm template sardeenz $(CHART_DIR) $(ARGS)

## helm-package: Package the chart as <name>-<version>.tgz (version from package.json)
helm-package: helm-lint
	@mkdir -p $(CHART_PACKAGE_DIR)
	helm package $(CHART_DIR) \
		--version $(CHART_VERSION) \
		--app-version $(CHART_VERSION) \
		--destination $(CHART_PACKAGE_DIR)
	@echo "Packaged: $(CHART_PACKAGE_DIR)/$(CHART_NAME)-$(CHART_VERSION).tgz"

## helm-push: Push the packaged chart to the OCI registry (run helm-package first)
##   Lands at quay.io/rh-aiservices-bu/sardeenz-chart:<version>
##   Requires: helm registry login quay.io
helm-push:
	helm push $(CHART_PACKAGE_DIR)/$(CHART_NAME)-$(CHART_VERSION).tgz $(CHART_OCI_REPO)
	@echo "Pushed: $(IMAGE_REGISTRY)/$(CHART_NAME):$(CHART_VERSION)"

## helm-package-push: Package and push the chart in one step
helm-package-push: helm-package helm-push

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
	@echo "Helm chart (version from package.json: $(APP_VERSION)):"
	@echo "  make helm-lint                 Lint the chart"
	@echo "  make helm-template [ARGS=...]  Render manifests to stdout"
	@echo "  make helm-package              Package chart -> $(CHART_PACKAGE_DIR)/"
	@echo "  make helm-push                 Push chart to $(IMAGE_REGISTRY)/$(CHART_NAME)"
	@echo "  make helm-package-push         Package and push"
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
