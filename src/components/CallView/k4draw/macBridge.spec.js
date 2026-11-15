import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/dialogs', () => ({ showWarning: vi.fn() }))
vi.mock('./macConsole.js', () => ({ consoleCmd: vi.fn(), consoleFrame: vi.fn(), consoleRtc: vi.fn(), consoleTick: vi.fn(), inCall: () => true, stopConsole: vi.fn() }))
vi.mock('./snapshot.js', () => ({ downloadSnapshot: vi.fn(), screenSnapshot: vi.fn() }))
vi.mock('./useDrawing.js', () => ({ onDraw: () => () => {}, myShow: () => null, PALETTE: [] }))

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

	it('ссылка «Открыть в приложении» и скрытый iframe', async () => {
		const m = await load('Safari')
		const url = 'k4draw://call?u=' + encodeURIComponent(location.origin + '/call/abc123')
		expect(m.appCallUrl('abc123')).toBe(url)
		m.openInApp('abc123')
		const f = document.body.querySelector('iframe')
		expect(f.getAttribute('src')).toBe(url)
		expect(f.style.display).toBe('none')
	})
})
