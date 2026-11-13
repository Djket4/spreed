/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/dialogs', () => ({ showWarning: vi.fn() }))
vi.mock('@nextcloud/router', () => ({ getRootUrl: () => '/sub' }))
const call = vi.hoisted(() => ({ in: true }))
vi.mock('./macConsole.js', () => ({ consoleCmd: vi.fn(), consoleFrame: vi.fn(), consoleTick: vi.fn(), inCall: () => call.in, stopConsole: vi.fn() }))

describe('macBridge: запуск без служебных окон', () => {
	let mod
	let open
	let frames
	beforeEach(async () => {
		call.in = true
		vi.useFakeTimers()
		vi.resetModules()
		open = vi.fn(() => ({ closed: false, close: vi.fn(), postMessage: vi.fn(), focus: vi.fn() }))
		vi.stubGlobal('open', open)
		window.open = open
		frames = []
		const ap = document.body.appendChild.bind(document.body)
		vi.spyOn(document.body, 'appendChild').mockImplementation((n) => {
			n.tagName === 'IFRAME' && frames.push(n.src)
			return ap(n)
		})
		mod = await import('./macBridge.js')
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	const perm = (get) => vi.stubGlobal('navigator', { platform: 'MacIntel', permissions: { query: () => Promise.resolve({ state: get() }) } })

	it('ссылка скачивания относительна к облаку', () => {
		expect(mod.MAC_DL).toBe('/sub/k4draw/')
	})

	it('приложение отвечает: окно моста, схема не трогается', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({})))
		await mod.openMac()
		expect(open).toHaveBeenCalledTimes(1)
		expect(open.mock.calls[0][0]).toBe('http://127.0.0.1:47811/')
		expect(frames).toEqual([])
		expect(mod.mac.st).toBe('wait')
	})

	it('не отвечает, схема не сработала: ни одного окна, плашка noapp', async () => {
		perm(() => 'prompt')
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(9000)
		await p
		expect(open).not.toHaveBeenCalled()
		expect(frames).toEqual(['k4draw://open'])
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

	it('потеря фокуса не считается запуском: noapp', async () => {
		perm(() => 'prompt')
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(300)
		window.dispatchEvent(new Event('blur'))
		await vi.advanceTimersByTimeAsync(9000)
		await p
		expect(mod.mac.st).toBe('noapp')
		expect(open).not.toHaveBeenCalled()
	})

	it('звонок кончился во время запуска: итог не затирает idle', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(600)
		window.dispatchEvent(new Event('pagehide'))
		await vi.advanceTimersByTimeAsync(9000)
		await p
		expect(mod.mac.st).toBe('idle')
	})

	it('окно моста заблокировано: плашка blocked, клик по кнопке открывает мост', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({})))
		open.mockReturnValueOnce(null)
		await mod.openMac()
		expect(mod.mac.st).toBe('blocked')
		mod.connectAnyway()
		expect(open).toHaveBeenCalledTimes(2)
		expect(mod.mac.st).toBe('wait')
	})

	// fetch, который висит, пока «пользователь не ответил»; abort по сигналу — AbortError, как в браузере
	const pendingFetch = (state) => vi.fn((u, { signal }) => new Promise((res, rej) => {
		const t = setInterval(() => {
			if (state.answer === 'allow') {
				clearInterval(t)
				res({})
			} else if (state.answer === 'block') {
				clearInterval(t)
				rej(new TypeError('Failed to fetch'))
			}
		}, 50)
		signal.addEventListener('abort', () => {
			clearInterval(t)
			rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
		})
	}))

	it('запрос браузера не отвечен: «разрешите доступ», не «не найдено»; после Allow мост сразу', async () => {
		const state = {}
		vi.stubGlobal('fetch', pendingFetch(state))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(15000)
		expect(mod.mac.st).toBe('allow')
		expect(open).not.toHaveBeenCalled()
		state.answer = 'allow'
		await vi.advanceTimersByTimeAsync(700)
		await p
		expect(open).toHaveBeenCalledTimes(1)
		expect(mod.mac.st).toBe('wait')
	})

	it('Block в браузере (доступ запрещён): плашка denied, схема не запускается', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
		perm(() => 'denied')
		await mod.openMac()
		expect(mod.mac.st).toBe('denied')
		expect(frames).toEqual([])
		mod.connectAnyway() // обход «Уже установлено»
		expect(open).toHaveBeenCalledTimes(1)
	})

	it('ждали запрос, потом Block: denied', async () => {
		const state = {}
		let st = 'prompt'
		vi.stubGlobal('fetch', pendingFetch(state))
		perm(() => st)
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(3000)
		expect(mod.mac.st).toBe('allow')
		st = 'denied'
		state.answer = 'block'
		await vi.advanceTimersByTimeAsync(3000)
		await p
		expect(mod.mac.st).toBe('denied')
		expect(open).not.toHaveBeenCalled()
	})

	it('закрыли плашку «разрешите доступ»: ожидание прекращено', async () => {
		vi.stubGlobal('fetch', pendingFetch({}))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(3000)
		mod.closeMissing()
		expect(mod.mac.st).toBe('idle')
		await vi.advanceTimersByTimeAsync(3000)
		await p
		expect(mod.mac.st).toBe('idle')
	})

	it('быстрые отказы без Permissions API (Safari): «не удалось проверить», «подключить вручную» в обход ping', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(9000)
		await p
		expect(mod.mac.st).toBe('unverified')
		expect(open).not.toHaveBeenCalled()
		mod.connectAnyway()
		expect(open).toHaveBeenCalledTimes(1)
		expect(mod.mac.st).toBe('wait')
	})

	it('Permissions API есть, быстрые отказы: noapp, не unverified', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))))
		perm(() => 'granted')
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(9000)
		await p
		expect(mod.mac.st).toBe('noapp')
	})

	it('все ответы 120 с — ожидание запроса: плашка «разрешите доступ» остаётся, не noapp', async () => {
		vi.stubGlobal('fetch', pendingFetch({}))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(130000)
		await p
		expect(mod.mac.st).toBe('allow')
		await vi.advanceTimersByTimeAsync(10000)
		expect(mod.mac.st).toBe('allow')
		expect(open).not.toHaveBeenCalled()
	})

	it('вышли из звонка (inCall=false) во время ожидания: мост не открывается, всё сброшено', async () => {
		const state = {}
		vi.stubGlobal('fetch', pendingFetch(state))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(3000)
		expect(mod.mac.st).toBe('allow')
		call.in = false
		state.answer = 'allow' // приложение ответило уже после выхода
		await vi.advanceTimersByTimeAsync(3000)
		await p
		expect(open).not.toHaveBeenCalled()
		expect(mod.mac.st).toBe('idle')
	})

	it('вышли из звонка во время первого ping: ни iframe, ни окна', async () => {
		vi.stubGlobal('fetch', pendingFetch({}))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(300)
		call.in = false
		await vi.advanceTimersByTimeAsync(3000)
		await p
		expect(frames).toEqual([])
		expect(open).not.toHaveBeenCalled()
		expect(mod.mac.st).toBe('idle')
	})

	it('pagehide во время первого ping: iframe не создаётся', async () => {
		vi.stubGlobal('fetch', pendingFetch({}))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(300)
		window.dispatchEvent(new Event('pagehide'))
		await vi.advanceTimersByTimeAsync(3000)
		await p
		expect(frames).toEqual([])
		expect(mod.mac.st).toBe('idle')
	})

	it('плашку закрыли во время ping: старый запуск её не возвращает', async () => {
		const state = {}
		vi.stubGlobal('fetch', pendingFetch(state))
		const p = mod.openMac()
		await vi.advanceTimersByTimeAsync(1300) // первый ping (wait) отработал, идёт ping цикла
		expect(mod.mac.st).toBe('allow')
		mod.closeMissing()
		expect(mod.mac.st).toBe('idle')
		state.answer = 'block'
		await vi.advanceTimersByTimeAsync(5000)
		await p
		expect(mod.mac.st).toBe('idle')
		expect(open).not.toHaveBeenCalled()
	})
})
