import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/dialogs', () => ({ showWarning: vi.fn() }))
vi.mock('@nextcloud/router', () => ({ getRootUrl: () => '/sub' }))

describe('macBridge: запуск без служебных окон', () => {
	let mod
	let open
	let clicked
	beforeEach(async () => {
		vi.useFakeTimers()
		vi.resetModules()
		open = vi.fn(() => ({ closed: false, close: vi.fn(), postMessage: vi.fn(), focus: vi.fn() }))
		vi.stubGlobal('open', open)
		window.open = open
		clicked = []
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function() { clicked.push(this.href) })
		mod = await import('./macBridge.js')
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it('ссылка скачивания относительна к облаку', () => {
		expect(mod.MAC_DL).toBe('/sub/k4draw/')
	})

	it('приложение отвечает: окно моста, схема не трогается', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({})))
		await mod.openMac()
		expect(open).toHaveBeenCalledTimes(1)
		expect(open.mock.calls[0][0]).toBe('http://127.0.0.1:47811/')
		expect(clicked).toEqual([])
		expect(mod.mac.st).toBe('wait')
	})

	it('не отвечает, схема не сработала: ни одного окна, плашка noapp', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(5000)
		await p
		expect(open).not.toHaveBeenCalled()
		expect(clicked).toEqual(['k4draw://open'])
		expect(mod.mac.st).toBe('noapp')
	})

	it('не отвечало, потом запустилось: start, окно только по второму клику', async () => {
		let n = 0
		vi.stubGlobal('fetch', vi.fn(() => (++n > 3 ? Promise.resolve({}) : Promise.reject(new TypeError('x')))))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(3000)
		await p
		expect(mod.mac.st).toBe('start')
		expect(open).not.toHaveBeenCalled()
		await mod.openMac()
		expect(open).toHaveBeenCalledTimes(1)
	})

	it('страница потеряла фокус (запрос «Открыть?»): start, не noapp', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(300)
		window.dispatchEvent(new Event('blur'))
		await vi.advanceTimersByTimeAsync(9000)
		await p
		expect(mod.mac.st).toBe('start')
		expect(open).not.toHaveBeenCalled()
	})
})
