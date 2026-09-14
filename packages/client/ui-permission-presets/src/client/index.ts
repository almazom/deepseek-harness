/**
 * Permission preset plugin, browser half — a popupSelect DECORATION hung on
 * the host `/permission` command: one flat list of presets, current value
 * marked active, a pick executes the switch. The decoration owns only the
 * bare invocation; the host command keeps its catalog row, the argued path
 * (`/permission <preset>` still switches directly), and the lifecycle
 * logging. Options and the active mark read the session's `permissions`
 * projection (the same host-computed select the composer chip renders); a
 * pick submits the `/permission <preset>` command line, so both surfaces
 * write through one path and the pushed projection frame is the one
 * confirmation. The Full access row carries the same explicit risk gate as
 * the composer chip; the shared popup shell owns the modal mechanics.
 * Surfaces without a materialized session (New Session) have no projection;
 * there the picker reads the presets of the host's permission settings
 * namespace — the same new-session default the General-settings row writes —
 * and a pick writes that default through the host Settings API. The
 * General-settings row separately writes the default preset for sessions
 * created later through the host Settings API.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings slot types (this package registers a General row).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/client'
import { PermissionRow } from './PermissionRow.tsx'
import type { PermissionRowInjected } from './PermissionRow.tsx'
import {
  accessEn, accessZh, en, zh,
} from './locales.ts'
import {
  displayPermissionPreset, FULL_ACCESS_PRESET,
} from './presentation.ts'
import {
  PERMISSION_SETTINGS_NS, permissionDefaultOf, PermissionPresetSettingsController,
} from './settings-store.ts'
import type { PermissionDefaultOption } from './settings-store.ts'

export type { PermissionRowInjected, PermissionRowProps } from './PermissionRow.tsx'
export type {
  PermissionDefaultOption, PermissionSettingsState,
} from './settings-store.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'commandUi', 'sessions', 'slots', 'locale', 'remote', 'remote.settings',
  'settingsScope', 'settingsSchema',
]

const ACCESS_NS = 'permission.access'

/** Read one session's current permissions projection value (undefined = capability absent). */
function selectOf(session: SessionFace | undefined): PermissionSelect | undefined {
  return session?.projections.faceOf('permissions').getSnapshot() as PermissionSelect | undefined
}

/** Flatten the projection select into popup rows; `custom` is display state, never a target. */
function optionsOf(value: PermissionSelect, t: (key: string) => string): SelectOption[] {
  return value.options
    .filter(option => option.value !== 'custom')
    .map(option => ({
      id: option.value,
      label: displayPermissionPreset(option.value, option.name, t),
      ...(option.description !== undefined ? { detail: option.description } : {}),
      ...(option.value === value.currentValue ? { active: true } : {}),
      ...(option.value === FULL_ACCESS_PRESET
        ? {
          confirmation: {
            title: t('confirm.title'),
            description: t('confirm.description'),
            acknowledgeLabel: t('confirm.acknowledge'),
            cancelLabel: t('confirm.cancel'),
            confirmLabel: t('confirm.enable'),
          },
        }
        : {}),
    }))
}

/**
 * Flatten the new-session defaults row into popup rows with the same
 * presentation as projection rows.
 * @param row - defaults read from the permission settings namespace schema.
 * @param t - picker locale dictionary.
 * @returns popup rows, the current default marked active.
 */
function defaultOptionsOf(
  row: {
    currentValue: string
    options: readonly PermissionDefaultOption[]
  },
  t: (key: string) => string,
): SelectOption[] {
  return row.options.map(option => ({
    id: option.id,
    label: displayPermissionPreset(option.id, option.label, t),
    ...(option.id === row.currentValue ? { active: true } : {}),
    ...(option.id === FULL_ACCESS_PRESET
      ? {
        confirmation: {
          title: t('confirm.title'),
          description: t('confirm.description'),
          acknowledgeLabel: t('confirm.acknowledge'),
          cancelLabel: t('confirm.cancel'),
          confirmLabel: t('confirm.enable'),
        },
      }
      : {}),
  }))
}

/**
 * Client plugin body: register the /permission popup picker over the
 * permissions projection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const command = ctx.get('commandUi') as CommandUiContract
  const sessions = ctx.sessions
  // This optional bundle and ui-conversation can load independently, so each
  // owns the same safety copy under its own locale namespace.
  /* jscpd:ignore-start */
  ctx.effect(() => {
    const disposers = [
      ctx.locale.register(ACCESS_NS, 'zh', {
        'preset.readOnly': accessZh['preset.readOnly'],
        'preset.workspaceWrite': accessZh['preset.workspaceWrite'],
        'preset.fullAccess': accessZh['preset.fullAccess'],
        'confirm.title': accessZh['confirm.title'],
        'confirm.description': accessZh['confirm.description'],
        'confirm.acknowledge': accessZh['confirm.acknowledge'],
        'confirm.cancel': accessZh['confirm.cancel'],
        'confirm.enable': accessZh['confirm.enable'],
      }),
      ctx.locale.register(ACCESS_NS, 'en', {
        'preset.readOnly': accessEn['preset.readOnly'],
        'preset.workspaceWrite': accessEn['preset.workspaceWrite'],
        'preset.fullAccess': accessEn['preset.fullAccess'],
        'confirm.title': accessEn['confirm.title'],
        'confirm.description': accessEn['confirm.description'],
        'confirm.acknowledge': accessEn['confirm.acknowledge'],
        'confirm.cancel': accessEn['confirm.cancel'],
        'confirm.enable': accessEn['confirm.enable'],
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-permission: Full access confirmation dictionaries')
  /* jscpd:ignore-end */
  const t = ctx.locale.bind(ACCESS_NS)
  const sessionFor = (session: ClientSessionContext): SessionFace | undefined =>
    sessions.binding(session.sessionId)?.session
  const permissionSettingsView = (): SettingsNamespaceView | undefined =>
    ctx.settingsScope.describe().getSnapshot().view?.namespaces
      .find(entry => entry.ns === PERMISSION_SETTINGS_NS)

  ctx.effect(() => ctx.locale.register('settings.permission', { zh, en }), 'ui-permission: settings row dictionaries')

  // The shared SettingsScope mirror updates after document commits and reconnects.
  const controller = new PermissionPresetSettingsController(
    ctx.settingsScope.describe(), ctx, ctx.settingsSchema)
  const load = (): Promise<void> => controller.load()
  const select = (preset: string): Promise<void> => controller.select(preset)
  const injected = (): PermissionRowInjected => ({
    hooks: { permission: controller.store },
    load,
    select,
  })

  // Picker availability and the defaults fallback read the settings mirror
  // without the settings page being open, so warm it here. A host whose
  // describe fails keeps the picker on the projection path only.
  void controller.load().catch(() => {})
  ctx.effect(() => () => { controller.dispose() }, 'ui-permission: settings row directory')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'permission',
    order: -20,
    locale: 'settings.permission',
    inject: injected,
  }, PermissionRow))

  ctx.effect(() => command.decorate({
    name: 'permission',
    // The picker exists while either source does: the session's permissions
    // projection, or the host's permission settings namespace. Unmaterialized
    // surfaces such as New Session have no projection; there the picker reads
    // the new-session default preset and a pick writes it, so the visible
    // chip never dead-ends. A permission-less host serves neither source and
    // the bare invocation falls through to the host command (which is absent
    // too — the line simply misses).
    available: session =>
      selectOf(sessionFor(session)) !== undefined ||
      permissionSettingsView() !== undefined,
    ui: {
      kind: 'popupSelect',
      options: async (session) => {
        const value = selectOf(sessionFor(session))
        if (value !== undefined) return optionsOf(value, t)
        await ctx.settingsScope.describe().ensure()
        const view = permissionSettingsView()
        if (view === undefined) throw new Error('permission presets are not available on this host')
        return defaultOptionsOf(permissionDefaultOf(view, ctx.settingsSchema), t)
      },
      onSelect: async (option, session) => {
        const live = sessionFor(session)
        if (live === undefined) {
          await select(option.id)
          return
        }
        const result = await live.command(`/permission ${option.id}`)
        if (!result.ok) throw new Error(`permission switch failed: ${result.error.code}: ${result.error.message}`)
        if (!result.value.matched) throw new Error('the host offers no /permission command')
      },
    },
  }), 'ui-permission: /permission decoration')
}
