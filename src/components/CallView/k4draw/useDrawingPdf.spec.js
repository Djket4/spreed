/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#107): PDF на доске постранично — фон 'p', листание, права листать
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sig = vi.hoisted(() => ({ getSessionId: () => 'me', doSend: vi.fn(), on: vi.fn(), off: vi.fn() }))
vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn() }))
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

import { canTurn, requestCloseBoard, sendSnap, setAutoSnap, showImage, state, strokeEnd, strokeStart, turnPage } from './useDrawing.js'

const pdf = (page) => ({ t: 'p', id: 7, page, pages: 3 })
const snapNow = vi.fn(async () => {
	sendSnap(1)
	return true
})
const sent = () => JSON.stringify(sig.doSend.mock.calls)

describe('PDF на доске', () => {
	beforeEach(() => {
		snapNow.mockClear()
		sig.doSend.mockClear()
		setAutoSnap(snapNow)
	})
	afterEach(async () => {
		state.mode = false
		await requestCloseBoard()
	})

	it('показ PDF: фон — первая страница, номер страницы уходит остальным', async () => {
		expect(await showImage(pdf(1))).toBe('')
		expect(state.bg).toEqual(pdf(1))
		expect(sent()).toContain('"pages":3')
	})

	it('мусорный фон PDF не принимается', async () => {
		for (const bad of [{ ...pdf(4) }, { ...pdf(0) }, { ...pdf(1), pages: 0 }, { ...pdf(1.5) }, { ...pdf(1), pages: 5000 }]) {
			expect(await showImage(bad)).toBe('Показ недоступен в этом звонке')
		}
	})

	it('листает владелец доски: в пределах страниц и не на ту же', async () => {
		await showImage(pdf(1))
		expect(canTurn()).toBe(true)
		expect(canTurn(2)).toBe(true)
		expect(canTurn(1)).toBe(false)
		expect(canTurn(0)).toBe(false)
		expect(canTurn(4)).toBe(false)
	})

	it('листание: новая страница, рисунок прежней уходит в Снимки', async () => {
		await showImage(pdf(1))
		const show = window.__k4draw.shows.get(state.keys.me)
		strokeEnd(show, strokeStart(show, 'marker', [0.1, 0.1], 0.5))
		sig.doSend.mockClear()
		expect(await turnPage(2)).toBe('')
		expect(snapNow).toHaveBeenCalledTimes(1)
		expect(state.bg).toEqual(pdf(2))
		expect(sent()).toContain('"page":2')
	})

	it('листание без рисунка: без снимка', async () => {
		await showImage(pdf(2))
		expect(await turnPage(3)).toBe('')
		expect(snapNow).not.toHaveBeenCalled()
	})

	it('чужая доска или не PDF: листать нельзя', async () => {
		await showImage({ t: 'm', id: 5 })
		expect(canTurn()).toBe(false)
		expect(await turnPage(2)).toBe('Листать может только тот, кто показывает')
		await showImage(pdf(1))
		state.board = 'other' // доску ведёт другой
		expect(canTurn()).toBe(false)
		expect(await turnPage(2)).toBe('Листать может только тот, кто показывает')
		state.board = 'me'
	})
})
