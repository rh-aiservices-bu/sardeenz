import type { GpuInfo, GpuStatus, GpuProcess, NvidiaSmiInfo, DriverInfo } from './gpu-info.js'

interface SimulatedGpu {
  index: number
  name: string
  totalMemoryMB: number
  usedMemoryMB: number
  models: Map<string, number>
}

class SimGpuTrackerImpl {
  private gpus: Map<number, SimulatedGpu> = new Map()

  initialize(gpuCount: number, memoryPerGpuGB: number): void {
    this.gpus.clear()
    for (let i = 0; i < gpuCount; i++) {
      this.gpus.set(i, {
        index: i,
        name: `Simulated GPU (${memoryPerGpuGB} GB)`,
        totalMemoryMB: memoryPerGpuGB * 1024,
        usedMemoryMB: 0,
        models: new Map(),
      })
    }
  }

  allocate(gpuIndex: number, instanceId: string, memoryMB: number): void {
    const gpu = this.gpus.get(gpuIndex)
    if (!gpu) {
      throw new Error(`Simulated GPU ${gpuIndex} not found`)
    }

    if (gpu.usedMemoryMB + memoryMB > gpu.totalMemoryMB) {
      const availableMB = gpu.totalMemoryMB - gpu.usedMemoryMB
      throw new Error(
        `Insufficient simulated GPU memory on GPU ${gpuIndex}: ` +
          `need ${memoryMB} MiB but only ${availableMB} MiB available ` +
          `(${gpu.totalMemoryMB} MiB total, ${gpu.usedMemoryMB} MiB used)`
      )
    }

    gpu.models.set(instanceId, memoryMB)
    gpu.usedMemoryMB += memoryMB
  }

  deallocate(instanceId: string): void {
    for (const gpu of this.gpus.values()) {
      const memoryMB = gpu.models.get(instanceId)
      if (memoryMB !== undefined) {
        gpu.usedMemoryMB -= memoryMB
        gpu.models.delete(instanceId)
      }
    }
  }

  getGpuInfo(): GpuInfo[] {
    return Array.from(this.gpus.values()).map((gpu) => ({
      index: gpu.index,
      name: gpu.name,
      totalMemoryMB: gpu.totalMemoryMB,
      totalMemoryGB: gpu.totalMemoryMB / 1024,
    }))
  }

  getNvidiaSmiInfo(): NvidiaSmiInfo {
    const driver: DriverInfo = {
      nvidiaSmiVersion: 'Simulated',
      driverVersion: 'Simulated',
      cudaVersion: 'Simulated',
    }

    const gpus: GpuStatus[] = Array.from(this.gpus.values()).map((gpu) => ({
      index: gpu.index,
      name: gpu.name,
      persistenceMode: 'N/A',
      busId: `SIM:${gpu.index}`,
      displayActive: 'N/A',
      eccErrors: null,
      fan: 'N/A',
      temperature: 'N/A',
      performanceState: 'N/A',
      powerUsage: 'N/A',
      powerCap: 'N/A',
      memoryUsed: `${gpu.usedMemoryMB}MiB`,
      memoryTotal: `${gpu.totalMemoryMB}MiB`,
      memoryUsedMB: gpu.usedMemoryMB,
      memoryTotalMB: gpu.totalMemoryMB,
      gpuUtilization: '0%',
      computeMode: 'N/A',
      migMode: null,
    }))

    const processes: GpuProcess[] = []
    for (const gpu of this.gpus.values()) {
      for (const [instanceId, memoryMB] of gpu.models) {
        processes.push({
          gpu: gpu.index,
          gi: 'N/A',
          ci: 'N/A',
          pid: 0,
          type: 'C',
          processName: `inference-sim [${instanceId.slice(0, 8)}]`,
          gpuMemory: `${memoryMB}MiB`,
          gpuMemoryMB: memoryMB,
        })
      }
    }

    return {
      timestamp: new Date().toISOString(),
      driver,
      gpus,
      processes,
    }
  }

  getAvailableMemoryMB(gpuIndex: number): number {
    const gpu = this.gpus.get(gpuIndex)
    if (!gpu) {
      throw new Error(`Simulated GPU ${gpuIndex} not found`)
    }
    return gpu.totalMemoryMB - gpu.usedMemoryMB
  }

  reset(): void {
    this.gpus.clear()
  }
}

export const simGpuTracker = new SimGpuTrackerImpl()
