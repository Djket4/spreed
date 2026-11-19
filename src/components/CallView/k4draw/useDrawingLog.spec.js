/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#114): рисунок сохраняется сам при закрытии доски и конце показа
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sig = vi.hoisted(() => ({ getSessionId: () => 'me', doSend: vi.fn(), on: vi.fn(), off: vi.fn() }))
const toast = vi.hoisted(() => ({ showError: vi.fn() }))
vi.mock('@nextcloud/dialogs', () => toast)
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (u) => u }))
vi.mock('../../../store/index.js', () => ({ default: { getters: {} } }))
vi.mock('../../../stores/actor.ts', () => ({ useActorStore: () => ({}) }))
vi.mock('../../../stores/token.ts', () => ({ useTokenStore: () => ({ token: 'tok' }) }))
vi.mock('../../../utils/k4log.js', () => ({ k4log: vi.fn() }))
vi.mock('../../../utils/webrtc/index.js', () => ({
	beforeLeaveCall: {},
	callParticipantCollection: { callParticipantModels: [], get: () => null },
	k4drawSignaling: () => sig,
}))

import { endShow, openBoard, requestCloseBoard, sendSnap, setAutoSnap, startShow, state, strokeEnd, strokeStart } from './useDrawing.js'
vi.mock('../../../utils/calllog.js', () => ({ calllog: vi.fn() }))
import { calllog } from '../../../utils/calllog.js'
import { clearAll, clearMine, endShow, openBoard, requestCloseBoard, sendSnap, state, strokeEnd, strokeStart } from './useDrawing.js'

const evs = () => calllog.mock.calls.map((c) => c[0])

describe('события доски в журнале (NAS_CLOUD#163)', () => {
	it('первый штрих — одна строка, лазер не считается, очистка и снимок пишутся', async () => {
		state.big = 'me'
		openBoard(1.5)
		const show = window.__k4draw.shows.get(state.keys.me)
		strokeEnd(show, strokeStart(show, 'laser', [0.1, 0.1], 0.5))
		expect(evs()).not.toContain('board_stroke')
		for (let i = 0; i < 5; i++) {
			strokeEnd(show, strokeStart(show, 'marker', [0.1, 0.1], 0.5))
		}
		expect(evs().filter((k) => k === 'board_stroke')).toHaveLength(1)
		clearMine()
		clearAll(show)
		sendSnap(1)
		expect(calllog).toHaveBeenCalledWith('board_clear', { all: 0 })
		expect(evs()).toContain('board_snap')
		await requestCloseBoard()
		await endShow()
	})
})
