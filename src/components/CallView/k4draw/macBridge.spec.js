/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/dialogs', () => ({ showWarning: vi.fn() }))
vi.mock('./macConsole.js', () => ({ consoleCmd: vi.fn(), consoleFrame: vi.fn(), consoleRtc: vi.fn(), consoleTick: vi.fn(), inCall: () => true, stopConsole: vi.fn() }))
vi.mock('./snapshot.js', () => ({ downloadSnapshot: vi.fn(), screenSnapshot: vi.fn() }))
vi.mock('./useDrawing.js', () => ({ onDraw: () => () => {}, myShow: () => null, localScreen: () => null, myId: () => 'me', PALETTE: [] }))

/**
 * @param ua User-Agent
 */
async function load(ua) {
	vi.resetModules()
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
	return import('./macBridge.js')
}

describe('macBridge: звонок в приложении K4Draw', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		delete window.webkit
	})

	it('inApp по User-Agent; appPost зовёт messageHandler', async () => {
		const post = vi.fn()
		window.webkit = { messageHandlers: { k4draw: { postMessage: post } } }
		const m = await load('Mozilla/5.0 Version/26.0 Safari/605.1.15 K4Draw/1.8.0')
		expect(m.inApp).toBe(true)
		m.appPost('mini')
		expect(post).toHaveBeenCalledWith({ t: 'mini' })
		expect((await load('Mozilla/5.0 Safari/605.1.15')).inApp).toBe(false)
	})

	it('appPost без приложения молчит', async () => {
		const m = await load('Safari')
		expect(() => m.appPost('left')).not.toThrow()
	})

	it('в приложении openMac сразу открывает окно моста, без fetch', async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)
		const open = vi.spyOn(window, 'open').mockReturnValue({ closed: false, close: vi.fn(), focus: vi.fn() })
		const m = await load('Safari K4Draw/1.8.0')
		m.openMac()
		expect(open.mock.calls[0][0]).toBe('http://127.0.0.1:47811/')
		expect(m.mac.st).toBe('wait')
		expect(fetchSpy).not.toHaveBeenCalled()
		vi.unstubAllGlobals()
	})

	it('в приложении окно моста молчит 8 с: ожидание прекращается, окно закрыто, «Мини» не прячет звонок', async () => {
		vi.useFakeTimers()
		const pop = { closed: false, close: vi.fn(), focus: vi.fn() }
		vi.spyOn(window, 'open').mockReturnValue(pop)
		const m = await load('Safari K4Draw/1.8.0')
		const r = m.openMacReady()
		vi.advanceTimersByTime(8000)
		expect(await r).toBe(false)
		expect(m.mac.st).toBe('idle')
		expect(pop.close).toHaveBeenCalled()
		vi.useRealTimers()
	})

	it('«Мини» ждёт ready от окна моста', async () => {
		const pop = { closed: false, close: vi.fn(), focus: vi.fn(), postMessage: vi.fn() }
		vi.spyOn(window, 'open').mockReturnValue(pop)
		const m = await load('Safari K4Draw/1.8.0')
		const r = m.openMacReady()
		window.dispatchEvent(new MessageEvent('message', { origin: 'http://127.0.0.1:47811', source: pop, data: { t: 'ready' } }))
		expect(await r).toBe(true)
		expect(m.mac.st).toBe('on')
	})

	describe('мост отказал после «Мини»: окну приложения restore (NAS_CLOUD#177)', () => {
		const ready = async () => {
			const post = vi.fn()
			window.webkit = { messageHandlers: { k4draw: { postMessage: post } } }
			const pop = { closed: false, close: vi.fn(), focus: vi.fn(), postMessage: vi.fn() }
			vi.spyOn(window, 'open').mockReturnValue(pop)
			const m = await load('Safari K4Draw/1.8.0')
			const r = m.openMacReady()
			const msg = (t) => window.dispatchEvent(new MessageEvent('message', { origin: 'http://127.0.0.1:47811', source: pop, data: { t } }))
			msg('ready')
			expect(await r).toBe(true)
			return { post, pop, msg, m }
		}
		const restored = (post) => post.mock.calls.some(([a]) => a.t === 'restore')
		afterEach(() => vi.useRealTimers())
		it('bye', async () => {
			const { post, msg, m } = await ready()
			expect(restored(post)).toBe(false)
			msg('bye')
			expect(restored(post)).toBe(true)
			expect(m.mac.st).toBe('lost')
		})
		it('обрыв без переподключения за 10 с', async () => {
			vi.useFakeTimers()
			const { post, msg } = await ready()
			msg('drop')
			vi.advanceTimersByTime(9000)
			expect(restored(post)).toBe(false)
			vi.advanceTimersByTime(1500)
			expect(restored(post)).toBe(true)
		})
		it('обрыв с переподключением — окно не трогаем', async () => {
			vi.useFakeTimers()
			const { post, msg } = await ready()
			msg('drop')
			vi.advanceTimersByTime(5000)
			msg('ready')
			vi.advanceTimersByTime(10000)
			expect(restored(post)).toBe(false)
		})
		it('окно моста закрыто', async () => {
			vi.useFakeTimers()
			const { post, pop } = await ready()
			pop.closed = true
			vi.advanceTimersByTime(1100)
			expect(restored(post)).toBe(true)
		})
	})

	it('окно моста заблокировано: «Мини» сразу false', async () => {
		vi.spyOn(window, 'open').mockReturnValue(null)
		const m = await load('Safari K4Draw/1.8.0')
		expect(await m.openMacReady()).toBe(false)
	})

	it('«Открыть в приложении»: окно с k4draw://call, не iframe (CSP режет iframe), окно закрывается через 20 с', async () => {
		vi.useFakeTimers()
		const w = { close: vi.fn() }
		const open = vi.spyOn(window, 'open').mockReturnValue(w)
		const m = await load('Safari')
		const url = 'k4draw://call?u=' + encodeURIComponent(location.origin + '/call/abc123')
		expect(m.appCallUrl('abc123')).toBe(url)
		m.openInApp('abc123')
		expect(open).toHaveBeenCalledWith(url, 'k4draw-call', expect.stringContaining('popup'))
		expect(document.body.querySelector('iframe')).toBe(null)
		vi.advanceTimersByTime(19000)
		expect(w.close).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1000)
		expect(w.close).toHaveBeenCalledOnce()
		vi.useRealTimers()
	})
})
