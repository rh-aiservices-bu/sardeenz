#!/bin/bash
set -e

# Start nginx in the background
nginx

# Start the backend server
cd /app
exec node apps/backend/dist/server.js
