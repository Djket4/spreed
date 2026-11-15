/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { K4_WAIT, k4Hold, k4Ladder, k4OfferKey, k4StopOnLeave, k4Up } from './k4reconnect.js'

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
