import { Type } from 'typebox'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

/** Manual live-test extension for the ask-user-question UI hooks -- lives
 * globally (~/.pi/agent/extensions/) so it's available in every session
 * regardless of which repo's cwd is active. NOT meant to ship; delete this
 * file once you're done testing.
 *
 * Unlike a slash command (registerCommand), this is a real tool the model
 * can choose to call mid-turn -- ask it something like "use the
 * ask_test_question tool to ask me something" and it should call this,
 * triggering the actual select/confirm/input UI panel in PassCode. */
const factory: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: 'ask_test_question',
    label: 'Ask test question',
    description:
      'Test tool: asks the user a multiple-choice question, then a yes/no confirmation, then a free-text question, via the UI question panel. Use this when the user asks you to test the ask-user-question feature.',
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const choice = await ctx.ui.select('Which kind of test?', [
        'Quick smoke test',
        'Full walkthrough',
        'Just vibes'
      ])
      const proceed = await ctx.ui.confirm('Proceed?', `You picked: ${choice ?? '(cancelled)'}`)
      if (!proceed) {
        ctx.ui.notify('Cancelled at the confirm step', 'warning')
        return { content: [{ type: 'text', text: 'User cancelled at the confirm step.' }], details: undefined }
      }
      const name = await ctx.ui.input('What should I call this test run?', 'e.g. my-first-test')
      ctx.ui.notify(`Done! Choice="${choice}" name="${name ?? '(none)'}"`, 'info')
      return {
        content: [{ type: 'text', text: `User answered: choice="${choice}", name="${name ?? '(none)'}"` }],
        details: undefined
      }
    }
  })
}

export default factory
