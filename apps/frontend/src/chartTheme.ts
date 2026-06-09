export const getNivoTooltipTheme = () => {
  const isDark = document.documentElement.classList.contains('pf-v6-theme-dark')
  return {
    tooltip: {
      container: {
        background: isDark ? '#1f1f1f' : '#ffffff',
        color: isDark ? '#e0e0e0' : '#151515',
        padding: '8px 12px',
        borderRadius: '4px',
        border: isDark ? '1px solid #3c3f42' : '1px solid #d2d2d2',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
      },
    },
  }
}
