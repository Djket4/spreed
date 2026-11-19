/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/axios', () => ({ default: { post: vi.fn(() => Promise.resolve({})) } }))
vi.mock('@nextcloud/auth', () => ({ getRequestToken: () => 'x' }))
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (u) => u }))

import axios from '@nextcloud/axios'
import { _k4buf, _k4split, k4log, startK4Log, stopK4Log } from './k4log.js'

describe('k4log', () => {
	beforeEach(() => {
		stopK4Log()
		_k4buf().length = 0
		axios.post.mockClear()
	})

	it('no-op вне звонка', () => {
		k4log('a', 1)
		expect(_k4buf()).toHaveLength(0)
	})

	it('кольцевой буфер 500', () => {
		startK4Log('abcd')
		for (let i = 0; i < 700; i++) {
			k4log('e', i)
		}
		expect(_k4buf()).toHaveLength(500)
		expect(_k4buf().at(-1).d).toBe(699)
	})

	it('tap обрезает метку до 60', () => {
		startK4Log('abcd')
		const b = document.createElement('button')
		b.setAttribute('aria-label', 'x'.repeat(200))
		document.body.appendChild(b)
		b.click()
		const tap = _k4buf().find((e) => e.k === 'tap')
		expect(tap.d.l).toHaveLength(60)
	})

	it('stop отправляет и выключает', () => {
		startK4Log('abcd')
		stopK4Log()
		expect(axios.post).toHaveBeenCalledTimes(1)
		k4log('a')
		expect(_k4buf()).toHaveLength(0)
	})

	it('делит пачку на части меньше лимита сервера', () => {
		const ev = Array.from({ length: 300 }, (_, i) => ({ t: i, k: 'e', d: 'я'.repeat(300) })) // кириллица: 6 байт на символ в json_encode
		const parts = _k4split(ev)
		expect(parts.length).toBeGreaterThan(1)
		expect(parts.flat()).toHaveLength(300)
		parts.forEach((p) => expect(JSON.stringify({ s: 'x', ev: p }).replace(/[^ -~]/g, '\\u0000').length).toBeLessThan(96 * 1024))
	})

	it('отклонённая часть (413) даёт cl_batch_lost с n, bytes, code', async () => {
		vi.useFakeTimers()
		startK4Log('abcd')
		_k4buf().length = 0
		axios.post.mockImplementationOnce(() => Promise.reject({ response: { status: 413 } }))
		k4log('a', 1)
		k4log('b', 2)
		await vi.advanceTimersByTimeAsync(4000)
		vi.useRealTimers()
		const lost = _k4buf().find((e) => e.k === 'cl_batch_lost')
		expect(lost.d.n).toBe(2)
		expect(lost.d.code).toBe(413)
		expect(lost.d.bytes).toBeGreaterThan(0)
	})

	it('обрыв сети возвращает события в очередь, а не cl_batch_lost', async () => {
		vi.useFakeTimers()
		startK4Log('abcd')
		_k4buf().length = 0
		axios.post.mockImplementationOnce(() => Promise.reject(new Error('net')))
		k4log('a', 1)
		await vi.advanceTimersByTimeAsync(4000)
		vi.useRealTimers()
		expect(_k4buf().map((e) => e.k)).toEqual(['a'])
	})
})
