/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#110 А2): `r` от гостя, показывающего экран, не обходит запрет гостям рисовать
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sig = vi.hoisted(() => ({ getSessionId: () => 'me', doSend: vi.fn(), on: vi.fn(), off: vi.fn() }))
const users = vi.hoisted(() => ({ m1: { attributes: { userId: 'mod' } }, g1: { attributes: {} }, g2: { attributes: {} } }))
vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn() }))
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (u) => u }))
vi.mock('../../../store/index.js', () => ({ default: { getters: {} } }))
vi.mock('../../../stores/actor.ts', () => ({ useActorStore: () => ({ actorType: 'users' }) }))
vi.mock('../../../stores/token.ts', () => ({ useTokenStore: () => ({ token: 'tok' }) }))
vi.mock('../../../utils/k4log.js', () => ({ k4log: vi.fn() }))
vi.mock('../../../utils/webrtc/index.js', () => ({
	beforeLeaveCall: {},
	callParticipantCollection: { callParticipantModels: [], get: (s) => users[s] ?? null },
	k4drawSignaling: () => sig,
}))

import { startShow, endShow, state } from './useDrawing.js'

const mark = (id, author) => ({ id, author, tool: 'marker', pts: [0.1, 0.1, 0.2, 0.2] })
const send = (d) => sig.on.mock.calls.find((c) => c[0] === 'message')[1]({ type: 'k4draw', v: 1, ...d })

describe('r от гостя при запрете (А2)', () => {
	beforeEach(async () => {
		await endShow()
		startShow() // подписка на сигналинг
		send({ from: 'g1', op: 'h', k: 'g1:s1' })
	})

	it('запрет: пометки гостя отброшены, пометки модератора приняты', () => {
		state.gd = false
		send({ from: 'g1', op: 'r', k: 'g1:s1', marks: [mark('a1', 'g1'), mark('a2', 'g2'), mark('a3', 'm1')], last: 1 })
		const keys = [...window.__k4draw.shows.get('g1:s1').marks.values()].map((m) => m.by)
		expect(keys).toEqual(['m1'])
	})

	it('рисовать можно: приняты все', () => {
		state.gd = true
		send({ from: 'g1', op: 'r', k: 'g1:s1', marks: [mark('b1', 'g1'), mark('b3', 'm1')], last: 1 })
		expect(window.__k4draw.shows.get('g1:s1').marks.size).toBe(2)
	})
})
