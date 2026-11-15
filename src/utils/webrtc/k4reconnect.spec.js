/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { K4_WAIT, k4Ladder } from './k4reconnect.js'

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
		expect(run.mock.calls).toEqual([[0]])
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
})
