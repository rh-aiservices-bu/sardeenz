import ModelManagement from './pages/ModelManagement'
import GpuInfo from './pages/GpuInfo'
import ModelBenchmark from './pages/ModelBenchmark'
import Settings from './pages/Settings'
import ChatbotPlayground from './pages/ChatbotPlayground'

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
    label: 'Model Management',
    itemId: 'model-management',
  },
  {
    path: '/chatbot-playground',
    element: <ChatbotPlayground />,
    label: 'Chatbot Playground',
    itemId: 'chatbot-playground',
  },
  {
    path: '/benchmark',
    element: <ModelBenchmark />,
    label: 'Model Benchmark',
    itemId: 'model-benchmark',
  },
  {
    path: '/gpu',
    element: <GpuInfo />,
    label: 'GPU Info',
    itemId: 'gpu-info',
  },
  {
    path: '/settings',
    element: <Settings />,
    label: 'Settings',
    itemId: 'settings',
  },
]
