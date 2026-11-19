/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// ket4tec (NAS_CLOUD#257): обрыв связи с окном моста — грейс, показ экрана не рвётся; bye — сразу
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const C = vi.hoisted(() => ({ cmd: vi.fn(() => false) }))
vi.mock('@nextcloud/dialogs', () => ({ showWarning: vi.fn() }))
vi.mock('./macConsole.js', () => ({ consoleCmd: C.cmd, consoleFrame: vi.fn(), consoleRtc: vi.fn(), consoleTick: vi.fn(), inCall: () => true, stopConsole: vi.fn() }))
vi.mock('./snapshot.js', () => ({ downloadSnapshot: vi.fn(), screenSnapshot: vi.fn() }))
vi.mock('./useDrawing.js', () => ({ onDraw: () => () => {}, myShow: () => null, PALETTE: [], localScreen: () => null, myId: () => 'me', identity: () => ({}), hash: () => 0 }))

describe('macBridge: связь с окном моста', () => {
	let m
	let pop
	const msg = (data) => {
		const e = new MessageEvent('message', { data, origin: 'http://127.0.0.1:47811' })
		Object.defineProperty(e, 'source', { value: pop })
		window.dispatchEvent(e)
	}
	const stopped = () => C.cmd.mock.calls.filter((c) => c[0] === 'stopShare').length
	beforeEach(async () => {
		vi.useFakeTimers()
		vi.resetModules()
		C.cmd.mockClear()
		pop = { closed: false, close: vi.fn(), focus: vi.fn(), postMessage: vi.fn() }
		vi.spyOn(window, 'open').mockReturnValue(pop)
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({}))) // приложение отвечает на ping — окно моста открывается
		m = await import('./macBridge.js')
		await m.openMac()
		msg({ t: 'hi' })
		expect(pop.postMessage).toHaveBeenCalledWith({ t: 'hi' }, 'http://127.0.0.1:47811')
		msg({ t: 'ready' })
		expect(m.mac.st).toBe('on')
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it('drop и возврат за грейс: показ не останавливается, связь снова on', () => {
		msg({ t: 'drop' })
		vi.advanceTimersByTime(9000)
		expect(m.mac.st).toBe('on')
		msg({ t: 'ready' })
		vi.advanceTimersByTime(30000)
		expect(m.mac.st).toBe('on')
		expect(stopped()).toBe(0)
	})

	it('drop без возврата: через 10 с связь потеряна, показ остановлен', () => {
		msg({ t: 'drop' })
		vi.advanceTimersByTime(10001)
		expect(m.mac.st).toBe('lost')
		expect(stopped()).toBe(1)
	})

	it('bye (приложение вышло, окно закрыто): сразу lost и стоп показа', () => {
		msg({ t: 'bye' })
		expect(m.mac.st).toBe('lost')
		expect(stopped()).toBe(1)
	})
})
