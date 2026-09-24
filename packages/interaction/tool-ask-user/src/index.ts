/**
 * Model-facing Consumer of the `ctx.userQuestions` capability seam.
 * The tool pauses until a UI provider returns a human answer, then feeds that
 * answer back into the agent loop as an ordinary tool result.
 *
 * @module @deepseek-ai/dsh-tool-ask-user
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions/types'
import '@deepseek-ai/dsh-user-questions'

export const name = 'tool-ask-user'
export const inject = ['tools', 'userQuestions']

const description = 'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. '
  + 'Send one or more questions, each with a stable id that will be echoed in the answer.'

/**
 * The option a UI takes when its countdown expires, if the caller offers none
 * of its own: the decision goes to the brainstorm skill instead of being
 * guessed. The label is a stable wire value — the composer localizes only its
 * display text — because it comes back as `selected` in the answer.
 */
const COLLECTIVE_OPTION: AskUserQuestionOption = {
  label: 'Collective decision (brainstorm)',
  description: 'Hand the decision to the brainstorm skill and fold the result into the plan.',
  autoDecide: true,
}

/**
 * Guarantee that every question offering options also offers the
 * collective-decision option, so a countdown always has somewhere to hand the
 * answer. Idempotent: a caller that already marked an `autoDecide` option keeps
 * exactly that one, and a question offering no options is left alone rather
 * than being given a choice it never had.
 * @param options - the caller's own options, if any.
 * @returns the options to display, with the collective option appended at most once.
 */
function withCollectiveOption(options: AskUserQuestionOption[] | undefined): AskUserQuestionOption[] | undefined {
  if (options === undefined || options.length === 0) return options
  if (options.some(option => option.autoDecide === true)) return options
  return [...options, COLLECTIVE_OPTION]
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'ask_user_question',
    description,
    parameters: {
      questions: {
        type: 'array',
        required: true,
        description: 'Questions to ask the user before continuing.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true, description: 'Stable id for this question; echoed in the answer.' },
            question: { type: 'string', required: true, description: 'The specific question to ask the user.' },
            header: {
              type: 'string',
              description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".',
            },
            options: {
              type: 'array',
              description: 'Optional choices to show the user. Put the option you recommend first and set "recommended": true on it; the legacy "(Recommended)" label suffix is also accepted. The host appends an autoDecide option to every question that offers options, and a countdown takes that one — not your recommended one.',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  label: { type: 'string', required: true, description: 'Short user-facing option label.' },
                  description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
                  recommended: {
                    type: 'boolean',
                    description: 'Set true on the option you suggest and put it first. It is not taken automatically when a countdown expires.',
                  },
                  autoDecide: {
                    type: 'boolean',
                    description: 'Set true on the option a countdown should take when the user does not answer; the host appends one such option if you omit it.',
                  },
                },
              },
            },
            multi_select: {
              type: 'boolean',
              description: 'Whether the user may select more than one option. Defaults to false.',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                selected: { type: 'array', required: true, items: { type: 'string' } },
                custom: { type: 'string' },
              },
            },
          },
          timed_out: {
            type: 'boolean',
            required: true,
            description: 'True when the countdown expired and the autoDecide option was taken automatically — the user did not answer.',
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const result = await ctx.userQuestions.ask({
        questions: args.questions.map((question) => {
          // Resolve the option list before building the item: `exactOptionalPropertyTypes`
          // forbids an optional property that is present but `undefined`.
          const options = withCollectiveOption(question.options)
          return {
            id: question.id,
            question: question.question,
            ...question.header !== undefined ? { header: question.header } : {},
            ...options !== undefined ? { options } : {},
            ...question.multi_select !== undefined ? { multiSelect: question.multi_select } : {},
          }
        }),
        ...exec.agent !== undefined ? { agent: exec.agent } : {},
        signal: exec.signal,
      })
      return {
        answers: result.answers.map(answer => ({
          id: answer.id,
          selected: [...answer.selected],
          ...answer.custom !== undefined ? { custom: answer.custom } : {},
        })),
        timed_out: result.answers.some(answer => answer.timedOut === true),
      }
    },
  }))
}
