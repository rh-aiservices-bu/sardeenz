import ModelManagement from './pages/ModelManagement'
import GpuInfo from './pages/GpuInfo'
import ModelBenchmark from './pages/ModelBenchmark'
import Settings from './pages/Settings'
import InferenceTests from './pages/InferenceTests'

export interface RouteConfig {
  path: string
  element: JSX.Element
  label: string
  itemId: string
}

export const routes: RouteConfig[] = [
  {
    path: '/',
    element: <ModelManagement />,
    label: 'Model Placement Management',
    itemId: 'model-management',
  },
  {
    path: '/gpu',
    element: <GpuInfo />,
    label: 'GPU Info',
    itemId: 'gpu-info',
  },
  {
    path: '/benchmark',
    element: <ModelBenchmark />,
    label: 'Model Benchmark',
    itemId: 'model-benchmark',
  },
  {
    path: '/inference-tests',
    element: <InferenceTests />,
    label: 'Inference Tests',
    itemId: 'inference-tests',
  },
  {
    path: '/settings',
    element: <Settings />,
    label: 'Settings',
    itemId: 'settings',
  },
]
