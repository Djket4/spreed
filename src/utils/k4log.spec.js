/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nextcloud/axios', () => ({ default: { post: vi.fn(() => Promise.resolve({})) } }))
vi.mock('@nextcloud/auth', () => ({ getRequestToken: () => 'x' }))
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (u) => u }))

import axios from '@nextcloud/axios'
import { _k4buf, k4log, startK4Log, stopK4Log } from './k4log.js'

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
})
