/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { K4_AFTER_ONLINE_MS, K4_HOLD_CHECK_MS, K4_SESSION_HOLD_MS, K4_WAIT, k4CanRejoin, k4Hold, k4Ladder, k4OfferKey, k4OwnAction, k4StopOnLeave, k4Up } from './k4reconnect.js'

describe('k4Ladder (NAS_CLOUD#183)', () => {
	let isUp
	let run
	let l

	beforeEach(() => {
		vi.useFakeTimers()
		isUp = false
		run = vi.fn()
		l = k4Ladder({ up: () => isUp, run })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test('first step is resume + ICE restart, repeated calls while waiting do nothing', () => {
		expect(l.go()).toBe(true)
		expect(l.go()).toBe(false)
		expect(run.mock.calls.map((c) => c[0])).toEqual([0])
	})

	test('escalates 0 → 1 → 2 and stays on 2 (new session) every 20 s', () => {
		l.go()
		vi.advanceTimersByTime(K4_WAIT[0])
		vi.advanceTimersByTime(K4_WAIT[1])
		vi.advanceTimersByTime(K4_WAIT[2])
		expect(run.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 2])
	})

	test('connection back by the check: ladder resets, next drop starts from 0', () => {
		l.go()
		isUp = true
		vi.advanceTimersByTime(K4_WAIT[0])
		expect(l.step()).toBe(0)
		isUp = false
		l.go()
		expect(run.mock.calls.map((c) => c[0])).toEqual([0, 0])
	})

	test('ok() resets before the check only when really up', () => {
		l.go()
		l.ok()
		expect(l.step()).toBe(1)
		isUp = true
		l.ok()
		expect(l.step()).toBe(0)
		vi.advanceTimersByTime(60000)
		expect(run).toHaveBeenCalledTimes(1)
	})

	test('stop() cancels the pending step action (resume callback after leaving)', () => {
		l.go()
		const alive = run.mock.calls[0][1]
		expect(alive()).toBe(true)
		l.stop()
		expect(alive()).toBe(false)
	})
})

describe('k4StopOnLeave (review P1-1)', () => {
	test('explicit leave stops the ladder at beforeLeaveCall, reconnect leave does not', () => {
		const handlers = {}
		const signaling = { on: (ev, fn) => Object.assign(handlers, { [ev]: fn }) }
		const ladder = { stop: vi.fn() }
		k4StopOnLeave(signaling, ladder)
		handlers.beforeLeaveCall('tok', true)
		expect(ladder.stop).not.toHaveBeenCalled()
		handlers.beforeLeaveCall('tok', false)
		expect(ladder.stop).toHaveBeenCalledTimes(1)
	})
})

describe('k4Up', () => {
	const ok = { connected: true, inCall: true, need: true, own: true, screen: undefined, subs: [] }

	test('own stream connected — up', () => {
		expect(k4Up(ok)).toBe(true)
	})

	test('review P1-2: peers removed by forceReconnect, rejoin pending — not up', () => {
		expect(k4Up({ ...ok, inCall: false, own: undefined, subs: [] })).toBe(false)
		expect(k4Up({ ...ok, own: undefined, subs: [] })).toBe(false) // поток нужен, но ещё не создан
	})

	test('review P1-3: broken own screen with healthy camera — not up', () => {
		expect(k4Up({ ...ok, screen: false })).toBe(false)
		expect(k4Up({ ...ok, screen: true })).toBe(true)
	})

	test('listener without own stream: up when any incoming stream is', () => {
		const l = { ...ok, need: false, own: undefined }
		expect(k4Up({ ...l, subs: [false, true] })).toBe(true)
		expect(k4Up({ ...l, subs: [false] })).toBe(false)
		expect(k4Up({ ...l, connected: false, subs: [true] })).toBe(false)
	})
})

describe('k4Hold (review P2-3)', () => {
	test('held only when lost, not when the participant left the call himself', () => {
		const p = { gone: true, ghost: false, inCall: true, explicit: false }
		expect(k4Hold(p)).toBe(true)
		expect(k4Hold({ ...p, explicit: true })).toBe(false)
		expect(k4Hold({ ...p, gone: false })).toBe(false)
		expect(k4Hold({ ...p, inCall: false })).toBe(false)
		expect(k4Hold({ ...p, ghost: true })).toBe(false)
	})
})

describe('k4OfferKey (review P2-1)', () => {
	test('camera and screen of one session use different retry timers', () => {
		expect(k4OfferKey('s1', 'video')).toBe('s1')
		expect(k4OfferKey('s1', 'screen')).not.toBe(k4OfferKey('s1', 'video'))
	})
})

describe('прогон 15.11, обрыв 8 с: живое не рвём', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test('media came back by itself while the socket is still down: no further step (no rejoin)', () => {
		let isLive = false
		const run = vi.fn()
		const l = k4Ladder({ up: () => false, live: () => isLive, run })
		l.go()
		vi.advanceTimersByTime(K4_WAIT[0])
		isLive = true // видео у остальных уже идёт, сокет ещё ждёт
		vi.advanceTimersByTime(K4_WAIT[1] + K4_WAIT[2] * 3)
		expect(run.mock.calls.map((c) => c[0])).toEqual([0, 1])
		expect(l.step()).toBe(0)
	})

	test('own stream in disconnected/checking is restarted, not recreated; only failed is recreated', () => {
		expect(k4OwnAction(1, 'disconnected')).toBe('restart')
		expect(k4OwnAction(1, 'checking')).toBe('restart')
		expect(k4OwnAction(1, 'failed')).toBe('recreate')
		expect(k4OwnAction(0, 'failed')).toBe('restart')
		expect(k4OwnAction(1, 'connected')).toBe('skip')
	})
})

describe('прогон 15.11 №2, ice 15 с: вход новой сессией не раньше возврата сети', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test('step 2 waits while hold() says so, runs once released; steps 0 and 1 are not held', () => {
		let held = true
		const run = vi.fn()
		const hold = vi.fn((s) => s === 2 && held)
		const l = k4Ladder({ up: () => false, run, hold })
		l.go()
		vi.advanceTimersByTime(K4_WAIT[0] + K4_WAIT[1] + 10 * K4_HOLD_CHECK_MS)
		expect(run.mock.calls.map((c) => c[0])).toEqual([0, 1])
		held = false
		vi.advanceTimersByTime(K4_HOLD_CHECK_MS)
		expect(run.mock.calls.map((c) => c[0])).toEqual([0, 1, 2])
		// hold получает время от начала обрыва
		expect(hold.mock.calls.at(-1)[1]).toBe(K4_WAIT[0] + K4_WAIT[1] + 11 * K4_HOLD_CHECK_MS)
	})

	test('k4CanRejoin: not offline, not right after online, not while the server still holds the session', () => {
		const ok = { online: true, sinceOnline: Infinity, sinceDrop: 40000, sigUp: false }
		expect(k4CanRejoin(ok)).toBe(true)
		expect(k4CanRejoin({ ...ok, online: false })).toBe(false)
		expect(k4CanRejoin({ ...ok, sinceOnline: K4_AFTER_ONLINE_MS - 1 })).toBe(false)
		expect(k4CanRejoin({ ...ok, sinceDrop: 13000 })).toBe(false) // как в прогоне: +13 с, сокет ещё не вернулся
		expect(k4CanRejoin({ ...ok, sinceDrop: 13000, sigUp: true })).toBe(true) // resume был, но медиа не вернулось
		expect(k4CanRejoin({ ...ok, sinceDrop: K4_SESSION_HOLD_MS })).toBe(true)
	})
})
