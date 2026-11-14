/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const track = { x: 1 }
const stream = { getVideoTracks: () => [track] }
vi.mock('../../../store/index.js', () => ({ default: { getters: { isInCall: () => true }, dispatch: vi.fn() } }))
vi.mock('../../../stores/actor.ts', () => ({ useActorStore: () => ({}) }))
vi.mock('../../../utils/webrtc/index.js', () => ({
	callParticipantCollection: { callParticipantModels: [] },
	localMediaModel: { attributes: { token: 't', audioEnabled: true, videoEnabled: true, localStream: stream } },
}))

describe('macConsole: кадры камер для приложения', () => {
	let mod
	let draw
	let enc
	beforeEach(async () => {
		vi.resetModules()
		draw = vi.fn()
		enc = vi.fn(() => 'data:image/jpeg;base64,AAAA' + enc.mock.calls.length)
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw })
		vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(enc)
		vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
		Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 })
		Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 })
		mod = await import('./macConsole.js')
	})

	it('старое приложение (tick без v): свежий кадр на каждый tick', () => {
		const send = vi.fn()
		mod.consoleTick(send)
		mod.consoleTick(send)
		expect(enc).toHaveBeenCalledTimes(2)
		expect(send.mock.calls[0][0].tiles[0].jpg).not.toBe(send.mock.calls[1][0].tiles[0].jpg)
	})

	it('приложение v2: tick отдаёт прошлый кадр, кодирует только fr', () => {
		const send = vi.fn()
		mod.consoleTick(send, true) // первого кадра ещё нет: кодируется
		mod.consoleTick(send, true)
		mod.consoleTick(send, true)
		expect(enc).toHaveBeenCalledTimes(1)
		expect(send.mock.calls[2][0].tiles[0].jpg).toBe(send.mock.calls[0][0].tiles[0].jpg)
		mod.consoleFrame(send)
		expect(enc).toHaveBeenCalledTimes(2)
		expect(send.mock.calls[3][0].t).toBe('call')
	})

	it('приложение v2: кадр квадратный 128×128, вырез по центру', () => {
		mod.consoleTick(vi.fn(), true)
		const cv = enc.mock.contexts[0]
		expect([cv.width, cv.height]).toEqual([128, 128])
		expect(draw.mock.calls[0].slice(1)).toEqual([280, 0, 720, 720, 0, 0, 128, 128])
		expect(mod.cropWindow(720, 1280)).toEqual([0, 280, 720, 720])
	})

	it('старое приложение (tick без v): кадр 160×90 cover, не квадрат', () => {
		mod.consoleTick(vi.fn())
		const cv = enc.mock.contexts[0]
		expect([cv.width, cv.height]).toEqual([160, 90])
		expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 160, 90])
	})

	// send тратит 20 мс «времени»: бюджет не даёт ответить на следующий fr сразу
	const slow = () => vi.fn(() => vi.advanceTimersByTime(20))

	it('fr слишком рано: ответ откладывается и уходит по таймеру', () => {
		vi.useFakeTimers()
		const send = slow()
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		expect(send).toHaveBeenCalledTimes(1)
		vi.advanceTimersByTime(500)
		expect(send).toHaveBeenCalledTimes(2)
		vi.useRealTimers()
	})

	it('повторные fr объединяются в один отложенный ответ', () => {
		vi.useFakeTimers()
		const send = slow()
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		vi.advanceTimersByTime(500)
		expect(send).toHaveBeenCalledTimes(2)
		vi.useRealTimers()
	})

	it('stopConsole снимает отложенный ответ', () => {
		vi.useFakeTimers()
		const send = slow()
		mod.consoleFrame(send)
		mod.consoleFrame(send)
		mod.stopConsole()
		vi.advanceTimersByTime(500)
		expect(send).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})
})
