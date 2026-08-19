import * as React from "react"

// 1025 so JS agrees with the CSS drawer rules (`max-width: 1024px`): the sidebar
// collapses to a drawer and content goes full-width for every device up to and
// including iPad landscape at 1024px. Above that (≥1025px) the persistent sidebar
// layout returns. JS uses `< 1025`, matchMedia uses `max-width: 1024px` — same cut.
const MOBILE_BREAKPOINT = 1025

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
