import { cpSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../client/tsdown.client.ts'

// Single node entry: the plugin namespace. The subpath exports
// (advisor-projection, dispatcher, latest-human) consume the tsc-emitted
// lib/types JavaScript directly; only the client face is bundled.
const build = clientBundle('@deepseek-ai/dsh-smart-steer', ['lib/types/index.js'])

// The published emitted tree (lib/types/client) imports its sheets by relative
// path; the browser bundle inlines the styles, so this copy step lands the
// physical sheets next to the emitted modules for the publication view.
function withEmittedCss(configs: ReturnType<typeof build>): ReturnType<typeof build> {
  return (env) => {
    const resolved = configs(env)
    return resolved.map((config) => {
      if (config.name !== '@deepseek-ai/dsh-smart-steer/client') return config
      return {
        ...config,
        plugins: [...(config.plugins ?? []), {
          name: 'dsh-smart-steer-emitted-css',
          closeBundle() {
            const sourceDir = join(import.meta.dirname, 'src/client')
            for (const sheet of readdirSync(sourceDir)) {
              if (!sheet.endsWith('.module.css')) continue
              cpSync(join(sourceDir, sheet), join(import.meta.dirname, 'lib/types/client', sheet))
            }
          },
        }],
      } satisfies UserConfig
    })
  }
}

export default withEmittedCss(build)
