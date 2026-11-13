/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/auth', () => ({ getRequestToken: () => 'rt' }))
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (u, p) => u.replace('{token}', p.token) }))

import { _buf, _reset, calllog, calllogRtc, calllogScreen, calllogSession, initCalllog } from './calllog.js'

describe('calllog', () => {
	beforeEach(() => {
		_reset()
		globalThis.fetch = vi.fn(() => Promise.resolve({}))
	})

	it('до сессии копит, с сессией шлёт пачкой с room session id', () => {
		calllog('a')
		calllogSession('abcd1234', 'SESSIONID')
		expect(fetch).toHaveBeenCalledTimes(1)
		const [url, opt] = fetch.mock.calls[0]
		expect(url).toBe('apps/spreed/api/v1/calllog/abcd1234')
		const body = JSON.parse(opt.body)
		expect(body.s).toBe('SESSIONID')
		expect(body.ev[0].k).toBe('a')
		expect(opt.keepalive).toBe(true)
		expect(opt.headers.requesttoken).toBe('rt')
		expect(_buf()).toHaveLength(0)
	})

	it('сбой fetch (синхронный и асинхронный) не пробрасывается', async () => {
		calllogSession('abcd1234', 'S')
		const both = (k) => {
			calllog(k)
			calllogSession('abcd1234', 'S')
		}
		globalThis.fetch = vi.fn(() => {
			throw new Error('boom')
		})
		expect(() => both('a')).not.toThrow()
		globalThis.fetch = vi.fn(() => Promise.reject(new Error('net')))
		expect(() => both('b')).not.toThrow()
		await Promise.resolve()
	})

	it('буфер ограничен 200', () => {
		for (let i = 0; i < 500; i++) {
			calllog('e', { i })
		}
		expect(_buf()).toHaveLength(200)
	})

	it('rtc: номер попытки растёт на обрывах', () => {
		calllogRtc('abcdefgh', 'connected')
		calllogRtc('abcdefgh', 'disconnected')
		calllogRtc('abcdefgh', 'failed')
		expect(_buf().map((e) => e.d.n)).toEqual([0, 1, 2])
		expect(_buf()[0].d.peer).toBe('abcdef')
	})

	it('показ экрана: stop только после start', () => {
		calllogScreen('stop')
		calllogScreen('start')
		calllogScreen('stop')
		calllogScreen('stop')
		calllogScreen('denied', 'NotAllowedError')
		expect(_buf().map((e) => e.k)).toEqual(['screen_start', 'screen_stop', 'screen_denied'])
	})

	it('pagehide отдаёт всё, ошибки JS пишутся именем и первой строкой', () => {
		initCalllog()
		calllogSession('abcd1234', 'S')
		window.dispatchEvent(Object.assign(new Event('error'), { message: 'первая\nвторая', error: new TypeError('x') }))
		window.dispatchEvent(new Event('pagehide'))
		const evs = fetch.mock.calls.flatMap((c) => JSON.parse(c[1].body).ev)
		expect(evs.find((e) => e.k === 'js_error').d).toEqual({ name: 'TypeError', msg: 'первая' })
		expect(evs.at(-1).k).toBe('pagehide')
		expect(evs.find((e) => e.k === 'page_load').d.ua).toBeTypeOf('string')
	})

	it('reject с объектом без прототипа не бросает из обработчика', () => {
		initCalllog()
		const bare = Object.create(null)
		const seen = vi.fn()
		window.addEventListener('error', seen) // исключение из обработчика jsdom сообщает ещё одним событием error
		window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: bare }))
		window.dispatchEvent(Object.assign(new Event('error'), { message: bare, error: bare }))
		window.removeEventListener('error', seen)
		expect(seen).toHaveBeenCalledTimes(1) // только само событие error из теста
	})

	it('403: пауза, буфер цел, после calllogSession отправка возобновляется', async () => {
		globalThis.fetch = vi.fn(() => Promise.resolve({ status: 403 }))
		calllogSession('abcd1234', 'OLD')
		calllog('x')
		await vi.waitFor(() => expect(_buf().length).toBeGreaterThan(0))
		const n = fetch.mock.calls.length
		calllog('y')
		calllogSession('abcd1234', 'OLD') // сессия та же, но пауза снимается только вызовом — проверим новую ниже
		await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(n))
		const before = fetch.mock.calls.length
		await new Promise((r) => setTimeout(r, 0))
		calllog('z')
		expect(fetch.mock.calls.length).toBe(before) // на паузе: не шлём
		expect(_buf().map((e) => e.k)).toContain('z')
		globalThis.fetch = vi.fn(() => Promise.resolve({ status: 200 }))
		calllogSession('abcd1234', 'NEW')
		expect(fetch).toHaveBeenCalledTimes(1)
		const body = JSON.parse(fetch.mock.calls[0][1].body)
		expect(body.s).toBe('NEW')
		expect(body.ev.map((e) => e.k)).toEqual(expect.arrayContaining(['x', 'y', 'z']))
	})

	it('/pre: только белый список и только без сессии; после сессии одно событие session', () => {
		history.pushState({}, '', '/call/abcd1234')
		initCalllog()
		calllog('rtc_state')
		calllog('join_blocked')
		expect(fetch).toHaveBeenCalledTimes(1)
		const [url, opt] = fetch.mock.calls[0]
		expect(url).toBe('apps/spreed/api/v1/calllog/abcd1234/pre')
		const body = JSON.parse(opt.body)
		expect(body.c).toMatch(/^[a-z0-9]{5}$/)
		expect(body.ev.map((e) => e.k)).toEqual(['page_load', 'join_blocked'])
		expect(_buf().map((e) => e.k)).toEqual(['rtc_state'])
		calllogSession('abcd1234', 'S')
		calllogSession('abcd1234', 'S2')
		const sent = fetch.mock.calls.slice(1).flatMap((c) => JSON.parse(c[1].body).ev)
		expect(sent.filter((e) => e.k === 'session')).toHaveLength(1)
		expect(sent.find((e) => e.k === 'session').d.cid).toBe(body.c)
		calllog('join_blocked') // с сессией /pre не используется
		expect(fetch.mock.calls.every((c, i) => i === 0 || !c[0].endsWith('/pre'))).toBe(true)
	})
})
