#!/bin/bash
# start-dev.sh - Development startup script with vLLM/KVCached environment setup
#
# This script:
# 1. Creates a Python virtual environment with vLLM and KVCached (if not exists)
# 2. Validates the environment by testing Python imports
# 3. Sets up environment variables for KVCached GPU memory sharing
# 4. Starts the backend development server
#
# Prerequisites:
# - uv (Python package manager): curl -LsSf https://astral.sh/uv/install.sh | sh
# - NVIDIA GPU with CUDA 12.x drivers
# - Python 3.12
#
# Options:
#   --force    Auto-reinstall environment without prompting if validation fails
#
# For more details, see docs/dev-setup.md

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$BACKEND_DIR/.venv"

# Parse command line arguments
FORCE_REINSTALL=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_REINSTALL=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "Error: 'uv' is not installed."
    echo "Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo ""
    echo "If you don't need GPU/vLLM support, you can run the server directly with:"
    echo "  npm run dev:server"
    exit 1
fi

# ============================================================================
# Validation and Installation Functions
# ============================================================================

# Check if venv exists and packages can be imported
check_venv_valid() {
    if [ ! -d "$VENV_DIR" ]; then
        return 1
    fi
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    python -c "import vllm; import kvcached" 2>/dev/null
    return $?
}

# Install vLLM package
install_vllm() {
    echo "Installing vLLM..."
    uv pip install vllm==0.11.0
}

# Install KVCached package
install_kvcached() {
    echo "Installing KVCached..."
    uv pip install kvcached --no-build-isolation
}

# Check and install missing packages
install_missing() {
    echo "Checking for missing packages..."
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"

    if ! python -c "import vllm" 2>/dev/null; then
        install_vllm
    else
        echo "vLLM is already installed."
    fi

    if ! python -c "import kvcached" 2>/dev/null; then
        install_kvcached
    else
        echo "KVCached is already installed."
    fi

    echo ""
    echo "Missing packages installed!"
}

# Create a fresh virtual environment
create_fresh_venv() {
    echo "Creating fresh Python virtual environment with vLLM and KVCached..."
    echo "This may take a few minutes."
    echo ""

    cd "$BACKEND_DIR"

    # Remove existing venv if present
    if [ -d "$VENV_DIR" ]; then
        echo "Removing existing virtual environment..."
        rm -rf "$VENV_DIR"
    fi

    # Ensure Python 3.12 is available (uv will download if needed)
    echo "Ensuring Python 3.12 is available..."
    uv python install 3.12

    uv venv .venv --python 3.12

    # Activate and install dependencies
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    install_vllm
    install_kvcached

    echo ""
    echo "Python environment setup complete!"
    echo ""
}

# Prompt user for action when environment is broken
prompt_user_action() {
    echo ""
    echo "=================================================="
    echo "  Python environment is incomplete or corrupted"
    echo "=================================================="
    echo ""

    # Check if running interactively (stdin is a terminal)
    if [ ! -t 0 ]; then
        echo "ERROR: Cannot prompt for action in non-interactive mode."
        echo ""
        echo "To fix the Python environment, run one of these commands:"
        echo ""
        echo "  # Option 1: Run the script directly (interactive)"
        echo "  cd apps/backend && ./scripts/start-dev.sh"
        echo ""
        echo "  # Option 2: Force reinstall automatically"
        echo "  cd apps/backend && ./scripts/start-dev.sh --force"
        echo ""
        exit 1
    fi

    echo "What would you like to do?"
    echo ""
    echo "  1) Install missing - Install only missing packages"
    echo "  2) Reinstall all   - Remove venv and reinstall everything"
    echo "  3) Skip venv       - Continue without Python environment"
    echo "  4) Stop            - Exit the script"
    echo ""
    read -r -p "Enter choice [1-4]: " choice

    case $choice in
        1)
            install_missing
            ;;
        2)
            create_fresh_venv
            ;;
        3)
            echo "Skipping venv setup..."
            echo "Warning: vLLM/KVCached features will not be available."
            ;;
        4)
            echo "Exiting."
            exit 0
            ;;
        *)
            echo "Invalid choice. Exiting."
            exit 1
            ;;
    esac
}

# ============================================================================
# Main Logic
# ============================================================================

cd "$BACKEND_DIR"

if [ ! -d "$VENV_DIR" ]; then
    # No venv exists - create fresh
    create_fresh_venv
elif ! check_venv_valid; then
    # Venv exists but is broken
    if [ "$FORCE_REINSTALL" = true ]; then
        echo "Force flag set - reinstalling environment..."
        create_fresh_venv
    else
        prompt_user_action
    fi
else
    # Venv exists and is valid
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    echo "Python environment validated successfully."
fi

# Set KVCached environment variables
export ENABLE_KVCACHED=true
export KVCACHED_AUTOPATCH=1
export CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0}

# Ensure vLLM is in PATH
export PATH="$VENV_DIR/bin:$PATH"

echo ""
echo "KVCached environment configured:"
echo "  ENABLE_KVCACHED=$ENABLE_KVCACHED"
echo "  KVCACHED_AUTOPATCH=$KVCACHED_AUTOPATCH"
echo "  CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
echo ""

# Run the backend development server
cd "$BACKEND_DIR"
exec npm run dev:server
