/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#158): служебные сессии (робот записи, SIP) не люди — как фильтр сетки в CallView.vue
import { describe, expect, it, vi } from 'vitest'

const models = vi.hoisted(() => [])
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (u) => u }))
vi.mock('../../../store/index.js', () => ({ default: { getters: {} } }))
vi.mock('../../../stores/actor.ts', () => ({ useActorStore: () => ({}) }))
vi.mock('../../../stores/token.ts', () => ({ useTokenStore: () => ({ token: 'tok' }) }))
vi.mock('../../../utils/k4log.js', () => ({ k4log: vi.fn() }))
vi.mock('../../../utils/webrtc/index.js', () => ({
	beforeLeaveCall: {},
	callParticipantCollection: { callParticipantModels: models, get: () => null },
	k4drawSignaling: () => ({ getSessionId: () => 'me', doSend: vi.fn(), on: vi.fn(), off: vi.fn() }),
}))

import { humans } from './useDrawing.js'

describe('humans()', () => {
	it('отбрасывает internal без видео, оставляет людей и internal с видео', () => {
		models.length = 0
		models.push(
			{ attributes: { peerId: 'a' } },
			{ attributes: { peerId: 'robot', internal: true, videoAvailable: false } },
			{ attributes: { peerId: 'sipcam', internal: true, videoAvailable: true } },
		)
		expect(humans().map((m) => m.attributes.peerId)).toEqual(['a', 'sipcam'])
	})
})
