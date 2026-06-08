/**
 * Hermes Workspace — desktop status banner
 *
 * A small floating banner shown when the React app detects a problem with
 * the Tauri host (e.g. running in a browser preview, Hermes CLI missing,
 * gateway unreachable). Stays out of the way and dismisses on click.
 */

import { useEffect, useState } from 'react'
import { hermesDesktop } from './tauri-bridge'

type BannerState = {
  visible: boolean
  level: 'info' | 'warn' | 'error'
  message: string
}

const HIDDEN: BannerState = { visible: false, level: 'info', message: '' }

export function DesktopStatusBanner() {
  const [state, setState] = useState<BannerState>(HIDDEN)

  useEffect(() => {
    if (!hermesDesktop.app.isTauri) {
      setState({
        visible: true,
        level: 'info',
        message: 'Browser preview mode — desktop features are disabled. Run `bun run tauri:dev` for the full experience.',
      })
      return
    }
    void hermesDesktop.bootstrap.status().then((status) => {
      if (!status) {
        setState({ visible: true, level: 'warn', message: 'Could not contact the Tauri host.' })
        return
      }
      if (!status.hermesInstalled) {
        setState({
          visible: true,
          level: 'error',
          message: 'Hermes Agent is not installed. The workspace will not be functional until it is.',
        })
      } else if (!status.gatewayReachable) {
        setState({
          visible: true,
          level: 'warn',
          message: 'Gateway is offline. Run `hermes gateway run` in another terminal to start it.',
        })
      } else {
        setState(HIDDEN)
      }
    })
  }, [])

  if (!state.visible) return null

  const colorClass =
    state.level === 'error'
      ? 'bg-red-900/90 text-red-50'
      : state.level === 'warn'
        ? 'bg-amber-900/90 text-amber-50'
        : 'bg-slate-900/80 text-slate-100'

  return (
    <button
      type="button"
      onClick={() => setState(HIDDEN)}
      className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-xs shadow-lg backdrop-blur ${colorClass}`}
    >
      {state.message}
    </button>
  )
}
