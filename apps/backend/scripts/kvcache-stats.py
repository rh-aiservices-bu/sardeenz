#!/usr/bin/env python3
"""Read KVCache memory stats from shared memory (like kvtop).

This script reads KVCache memory information directly from shared memory
segments in /dev/shm, mimicking the behavior of kvtop from the kvcached project.

Output format (JSON array):
[
  {
    "ipc_name": "kvcached_vllm_GPU0",
    "gpu_indices": [0],
    "total_size": 6580224000,
    "used_size": 123456789,
    "prealloc_size": 987654321
  },
  {
    "ipc_name": "kvcached_vllm_GPU0_GPU1",
    "gpu_indices": [0, 1],
    "total_size": 3290112000,
    "used_size": 0,
    "prealloc_size": 0
  }
]
"""

import fcntl
import re
import json
import mmap
import os
import sys

try:
    import numpy as np
except ImportError:
    # If numpy is not available, output empty array and exit
    print("[]")
    sys.exit(0)

SHM_DIR = "/dev/shm"
DTYPE = np.int64
N_FIELDS = 3
SHM_SIZE = np.dtype(DTYPE).itemsize * N_FIELDS  # 24 bytes (3 x int64)

# Pattern for per-GPU IPC segment names: kvcached_vllm_GPU{id} or kvcached_vllm_GPU{id1}_GPU{id2}
GPU_SEGMENT_PATTERN = re.compile(r"^kvcached_vllm_GPU(\d+(?:_GPU\d+)*)$")


def parse_gpu_indices(ipc_name: str) -> list[int] | None:
    """Extract GPU indices from IPC segment name.

    Args:
        ipc_name: Name of the shared memory segment

    Returns:
        List of GPU indices [0], [0, 1], etc. or None for legacy/unknown segments

    Examples:
        'kvcached_vllm_GPU0' -> [0]
        'kvcached_vllm_GPU0_GPU1' -> [0, 1]
        'kvcached_vllm_GPU1_GPU2_GPU3' -> [1, 2, 3]
        'kvcached_mem_info' -> None (legacy global segment)
    """
    match = GPU_SEGMENT_PATTERN.match(ipc_name)
    if match:
        # Split "0_GPU1_GPU2" into ["0", "1", "2"]
        parts = match.group(1).split("_GPU")
        return [int(p) for p in parts]
    return None


def read_mem_info(ipc_name: str) -> dict | None:
    """Read memory info from a single shared memory segment.

    Args:
        ipc_name: Name of the shared memory segment file in /dev/shm

    Returns:
        Dict with ipc_name, gpu_indices, total_size, used_size, prealloc_size
        or None on error. gpu_indices is None for legacy segments.
    """
    path = os.path.join(SHM_DIR, ipc_name)
    try:
        with open(path, "r+b") as f:
            # Acquire shared lock for reading
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                mm = mmap.mmap(f.fileno(), SHM_SIZE, access=mmap.ACCESS_READ)
                try:
                    # Read as numpy array: [total_size, used_size, prealloc_size]
                    arr = np.ndarray((N_FIELDS,), dtype=DTYPE, buffer=mm)
                    return {
                        "ipc_name": ipc_name,
                        "gpu_indices": parse_gpu_indices(ipc_name),
                        "total_size": int(arr[0]),
                        "used_size": int(arr[1]),
                        "prealloc_size": int(arr[2]),
                    }
                finally:
                    mm.close()
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
    except (FileNotFoundError, PermissionError, OSError, ValueError):
        return None


def detect_kvcache_segments() -> list[str]:
    """Detect KVCache segments in /dev/shm by size and content.

    KVCache segments are identified by:
    1. File size exactly equals SHM_SIZE (24 bytes)
    2. First field (total_size) is greater than 0

    Returns:
        Sorted list of valid KVCache segment names
    """
    candidates = []
    try:
        for fname in os.listdir(SHM_DIR):
            path = os.path.join(SHM_DIR, fname)
            try:
                st = os.stat(path)
                # Check file size matches MemInfoStruct size
                if st.st_size == SHM_SIZE:
                    # Verify it's a valid KVCache segment by reading it
                    info = read_mem_info(fname)
                    if info and info["total_size"] > 0:
                        candidates.append(fname)
            except (OSError, PermissionError):
                continue
    except FileNotFoundError:
        pass
    return sorted(candidates)


def main():
    """Main entry point - detect and read all KVCache segments."""
    segments = detect_kvcache_segments()
    results = []
    for seg in segments:
        info = read_mem_info(seg)
        if info:
            results.append(info)
    print(json.dumps(results))


if __name__ == "__main__":
    main()
