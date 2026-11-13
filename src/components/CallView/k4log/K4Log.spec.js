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

	test('плашка знает все 8 ключей предупреждений', () => {
		const names = { drop: 'обрыв', loss: 'потери', rtt: 'задержка', jit: 'дрожит звук', novideo: 'нет видео', noaudio: 'нет звука', fps: 'рывки', own: 'свой канал' }
		k4stats.peers.a = { kbps: 1, loss: 0, rtt: 1, jit: 1, fps: 1, path: 'host', warn: Object.keys(names).map((w) => ({ w, lvl: 'yellow' })) }
		const w = mount(K4TileStats, { props: { peerId: 'a' } })
		expect(w.findAll('.k4ts-yellow').map((x) => x.text())).toEqual(Object.values(names))
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

	test('d как [] и все виды обрабатываются', async () => {
		const ev = ['page_load', 'join_click', 'call_joined', 'join_blocked', 'call_left', 'gum_ok', 'gum_err', 'signaling', 'rtc_state', 'screen_start', 'screen_stop', 'screen_denied', 'pagehide', 'js_error', 'net', 'framing_error', 'rtc_stats', 'rtc_path', 'rtc_warn', 'board_open', 'board_close', 'draw_mode', 'media', 'session']
		get.mockResolvedValue({ data: { ocs: { data: { now: 1, events: ev.map((k) => ({ t: 1, name: 'x', k, d: [] })) } } } })
		const w = mount(K4CallLogTab)
		await flushPromises()
		expect(w.findAll('.k4cl-row')).toHaveLength(ev.length)
		w.unmount()
	})

	test('rtc_stats с цифрами, предупреждение drop красным, все 8 ключей', async () => {
		const warns = ['drop', 'loss', 'rtt', 'jit', 'novideo', 'noaudio', 'fps', 'own']
		get.mockResolvedValue({ data: { ocs: { data: { now: 1, events: [
			{ t: 1, name: 'a', k: 'rtc_stats', d: { up: 1200, upl: 0, dn: 3400, dnl: 2, rtt: 80, path: 'relay' } },
			...warns.map((w) => ({ t: 2, name: 'a', k: 'rtc_warn', d: { peer: 'p', w, lvl: 'red', on: 1 } })),
		] } } } })
		const w = mount(K4CallLogTab)
		await flushPromises()
		const t = w.text()
		expect(t).toContain('↑ 1,2 Мбит/с 0% · ↓ 3,4 Мбит/с 2% · 80 мс · TURN')
		for (const s of ['обрыв', 'потери', 'задержка', 'дрожание звука', 'нет видео', 'нет звука', 'видео рывками', 'свой канал']) {
			expect(t).toContain(s)
		}
		expect(w.findAll('.k4cl-bad')).toHaveLength(8)
		w.unmount()
	})

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
