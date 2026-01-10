# Sardeenz Container Build
# Usage: make build VERSION=x.y.z

IMAGE_REGISTRY := quay.io/rh-aiservices-bu
IMAGE_NAME := sardeenz
CONTAINERFILE := docker/Containerfile

# Default version (can be overridden)
VERSION ?= latest

# Full image tag
IMAGE_TAG := $(IMAGE_REGISTRY)/$(IMAGE_NAME):$(VERSION)

.PHONY: build push help

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

## help: Show this help
help:
	@echo "Sardeenz Container Build"
	@echo ""
	@echo "Usage:"
	@echo "  make build VERSION=x.y.z    Build container image"
	@echo "  make push VERSION=x.y.z     Push to quay.io"
	@echo "  make build-push VERSION=x.y.z  Build and push"
	@echo ""
	@echo "Image: $(IMAGE_REGISTRY)/$(IMAGE_NAME):<VERSION>"
