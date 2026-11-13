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

function draw() {
	const show = window.__k4draw.shows.get(state.keys.me)
	strokeEnd(show, strokeStart(show, 'marker', [0.1, 0.1], 0.5))
	return show
}
const snapNow = vi.fn(async () => {
	sendSnap(1) // как успешный shoot()
	return true
})

describe('автосохранение рисунка (NAS_CLOUD#114)', () => {
	beforeEach(() => {
		snapNow.mockClear()
		setAutoSnap(snapNow)
		state.big = 'me'
	})
	afterEach(async () => {
		state.mode = false
		window.__k4draw.shows.get(state.keys.me)?.k.includes(':b') ? (await requestCloseBoard()) : await endShow()
	})

	it('закрытие доски с новым рисунком: снимок, затем закрытие', async () => {
		openBoard(1.5)
		draw()
		await requestCloseBoard()
		expect(snapNow).toHaveBeenCalledTimes(1)
		expect(state.board).toBe(null)
	})

	it('доска без изменений после снимка: закрывается без снимка', async () => {
		openBoard(1.5)
		draw()
		const show = window.__k4draw.shows.get(state.keys.me)
		sendSnap(1)
		expect(show.dirty).toBe(false)
		await requestCloseBoard()
		expect(snapNow).not.toHaveBeenCalled()
		expect(state.board).toBe(null)
	})

	it('пустая доска: без снимка', async () => {
		openBoard(1.5)
		await requestCloseBoard()
		expect(snapNow).not.toHaveBeenCalled()
	})

	it('конец показа с пометками: снимок до того, как они пропадут', async () => {
		startShow()
		draw()
		await endShow()
		expect(snapNow).toHaveBeenCalledTimes(1)
		expect(window.__k4draw.shows.get(state.keys.me)).toBeUndefined()
	})

	it('конец показа без пометок: без снимка', async () => {
		startShow()
		await endShow()
		expect(snapNow).not.toHaveBeenCalled()
	})

	it('сбой снимка при закрытии: доска остаётся, тост; повторное «Закрыть» закрывает без сохранения', async () => {
		openBoard(1.5)
		draw()
		toast.showError.mockClear()
		snapNow.mockResolvedValueOnce(false)
		await requestCloseBoard()
		expect(state.board).toBe('me')
		expect(toast.showError).toHaveBeenCalledTimes(1)
		await requestCloseBoard()
		expect(snapNow).toHaveBeenCalledTimes(1) // второй раз не пробуем
		expect(state.board).toBe(null)
	})

	it('после сбоя новый штрих: снова пробуем сохранить', async () => {
		openBoard(1.5)
		draw()
		snapNow.mockResolvedValueOnce(false)
		await requestCloseBoard()
		expect(state.board).toBe('me')
		draw()
		await requestCloseBoard() // успешный снимок -> закрылась
		expect(snapNow).toHaveBeenCalledTimes(2)
		expect(state.board).toBe(null)
	})

	it('после сбоя успешный снимок сбрасывает отметку: следующий сбой снова держит доску', async () => {
		openBoard(1.5)
		draw()
		snapNow.mockResolvedValueOnce(false)
		await requestCloseBoard()
		sendSnap(2) // доска сохранена другим путём (кнопка снимка)
		draw()
		snapNow.mockResolvedValueOnce(false)
		await requestCloseBoard()
		expect(state.board).toBe('me') // не закрылась «по отметке»
		await requestCloseBoard()
		expect(state.board).toBe(null)
	})

	it('указка после сбоя не сбрасывает отметку: второе «Закрыть» закрывает без попытки', async () => {
		openBoard(1.5)
		draw()
		snapNow.mockResolvedValueOnce(false)
		await requestCloseBoard()
		const show = window.__k4draw.shows.get(state.keys.me)
		strokeEnd(show, strokeStart(show, 'laser', [0.2, 0.2], 0.5))
		await requestCloseBoard()
		expect(snapNow).toHaveBeenCalledTimes(1)
		expect(state.board).toBe(null)
	})

	it('снимок уже идёт (двойной клик): ни тоста, ни отметки, ни закрытия; потом работает как обычно', async () => {
		openBoard(1.5)
		draw()
		toast.showError.mockClear()
		let busy = true
		setAutoSnap(snapNow, () => busy)
		await requestCloseBoard()
		expect(toast.showError).not.toHaveBeenCalled()
		expect(snapNow).not.toHaveBeenCalled()
		expect(state.board).toBe('me')
		busy = false
		await requestCloseBoard()
		expect(snapNow).toHaveBeenCalledTimes(1)
		expect(state.board).toBe(null)
	})
})
