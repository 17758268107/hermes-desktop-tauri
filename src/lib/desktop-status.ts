/**
 * Hermes Workspace — Tauri/Desktop bootstrap probe
 *
 * The Vite/TanStack Start app starts up in the browser, then this module
 * (called from the root layout on mount) asks the Tauri host what the
 * real status of the desktop shell is: is Hermes installed, is the
 * gateway reachable, etc. The result feeds the splash screen and the
 * "Setup required" overlay.
 */

import { hermesDesktop } from './tauri-bridge'

export type BootstrapSnapshot = {
  platform: string
  version: string
  hermesInstalled: boolean
  gatewayReachable: boolean
  dashboardReachable: boolean
  installerRunning: boolean
  settingsComplete: boolean
  checkedAt: number
  inTauri: boolean
}

const EMPTY: BootstrapSnapshot = {
  platform: 'browser',
  version: '0.0.0',
  hermesInstalled: false,
  gatewayReachable: false,
  dashboardReachable: false,
  installerRunning: false,
  settingsComplete: false,
  checkedAt: 0,
  inTauri: false,
}

export async function probeDesktopStatus(): Promise<BootstrapSnapshot> {
  if (!hermesDesktop.app.isTauri) {
    return { ...EMPTY, checkedAt: Date.now() }
  }
  const status = await hermesDesktop.bootstrap.status()
  if (!status) {
    return { ...EMPTY, inTauri: true, checkedAt: Date.now() }
  }
  return {
    platform: status.platform,
    version: status.version,
    hermesInstalled: status.hermesInstalled,
    gatewayReachable: status.gatewayReachable,
    dashboardReachable: status.dashboardReachable,
    installerRunning: status.installerRunning,
    settingsComplete: status.settingsComplete,
    checkedAt: Date.now(),
    inTauri: true,
  }
}

export function summarize(snapshot: BootstrapSnapshot): string {
  if (!snapshot.inTauri) return 'running in browser'
  if (!snapshot.hermesInstalled) return 'Hermes CLI missing — install to continue'
  if (!snapshot.gatewayReachable) return 'Gateway offline'
  if (!snapshot.dashboardReachable) return 'Gateway OK · Dashboard offline'
  return 'All systems online'
}
