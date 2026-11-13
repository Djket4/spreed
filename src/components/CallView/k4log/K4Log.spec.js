/*
 * ket4tec: журнал звонка (NAS_CLOUD#189)
 */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import K4CallLogTab from './K4CallLogTab.vue'
import K4TileStats from './K4TileStats.vue'
import { k4stats } from '../../../utils/k4stats.js'

const get = vi.hoisted(() => vi.fn())
vi.mock('@nextcloud/axios', () => ({ default: { get } }))
vi.mock('../../../composables/useGetToken.ts', () => ({ useGetToken: () => 'tok' }))

describe('K4TileStats', () => {
	beforeEach(() => {
		k4stats.testmode = true
		k4stats.peers = {}
	})
	afterEach(() => {
		k4stats.testmode = false
		k4stats.peers = {}
	})

	test('вне тест-режима в DOM ничего нет', () => {
		k4stats.testmode = false
		expect(mount(K4TileStats, { props: { peerId: 'a' } }).find('[data-k4ts]').exists()).toBe(false)
	})

	test('нет данных (null) показывает прочерк, не 0', () => {
		k4stats.peers.a = { kbps: null, loss: null, rtt: null, jit: null, fps: null, path: null, warn: [] }
		const w = mount(K4TileStats, { props: { peerId: 'a' } })
		expect(w.text()).toBe('— · — · —')
	})

	test('красное предупреждение и TURN', () => {
		k4stats.peers.a = { kbps: 1200, loss: 20, rtt: 80, jit: null, fps: null, path: 'relay', warn: [{ w: 'loss', lvl: 'red' }] }
		const w = mount(K4TileStats, { props: { peerId: 'a' } })
		expect(w.find('.k4ts-red').text()).toBe('потери')
		expect(w.find('.k4ts-turn').exists()).toBe(true)
		expect(w.text()).toContain('1,2 Мбит/с · 20% · 80 мс')
	})
})

describe('K4CallLogTab', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		get.mockReset()
		get.mockResolvedValue({ data: { ocs: { data: { now: 5.5, events: [{ t: 1, name: 'Аня', k: 'join_blocked', d: {} }] } } } })
	})
	afterEach(() => vi.useRealTimers())

	test('шлёт since из now и перестаёт опрашивать после unmount', async () => {
		const w = mount(K4CallLogTab)
		await flushPromises()
		expect(get.mock.calls[0][1].params.since).toBe(0)
		expect(w.find('.k4cl-bad').exists()).toBe(true)
		await vi.advanceTimersByTimeAsync(3000)
		expect(get.mock.calls[1][1].params.since).toBe(5.5)
		w.unmount()
		await vi.advanceTimersByTimeAsync(9000)
		expect(get).toHaveBeenCalledTimes(2)
	})
})
