/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#183, прогон 15.11): обрыв ≥15 с — сокет ждал «Reconnect in 21750», сервер за это время снял сессию

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Signaling, { K4_FAST_RECONNECT_MS, K4_RESUME_WINDOW_MS } from './signaling.js'

describe('Standalone signaling: переподключение в окне resume', () => {
	let fake

	beforeEach(() => {
		vi.useFakeTimers()
		fake = {
			initialReconnectIntervalMs: 1000,
			maxReconnectIntervalMs: 16000,
			reconnectIntervalMs: 16000, // backoff уже накоплен
			connect: vi.fn(),
			k4Kick: Signaling.Standalone.prototype.k4Kick,
			on: vi.fn(),
			off: vi.fn(),
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	const delay = () => {
		const spy = vi.spyOn(window, 'setTimeout')
		Signaling.Standalone.prototype.reconnect.call(fake)
		const ms = spy.mock.calls.at(-1)[1]
		spy.mockRestore()
		window.clearTimeout(fake.reconnectTimer)
		fake.reconnectTimer = null
		return ms
	}

	test('first 30 s after the drop the socket retries at least every 2 s', () => {
		expect(delay()).toBeLessThanOrEqual(K4_FAST_RECONNECT_MS)
		vi.advanceTimersByTime(K4_RESUME_WINDOW_MS - 1000)
		fake.reconnectIntervalMs = 16000
		expect(delay()).toBeLessThanOrEqual(K4_FAST_RECONNECT_MS)
	})

	test('after the window the normal backoff applies again', () => {
		delay()
		vi.advanceTimersByTime(K4_RESUME_WINDOW_MS + 1000)
		fake.reconnectIntervalMs = 16000
		expect(delay()).toBeGreaterThan(K4_FAST_RECONNECT_MS)
	})

	test('network back (k4Kick): pending wait is dropped, connect now, backoff reset', () => {
		fake.reconnectTimer = window.setTimeout(() => {}, 21750)
		Signaling.Standalone.prototype.k4Kick.call(fake)
		expect(fake.connect).toHaveBeenCalledTimes(1)
		expect(fake.reconnectTimer).toBe(null)
		expect(fake.reconnectIntervalMs).toBe(1000)
	})

	test('ladder step (k4Resume) while the socket waits its backoff connects right away', () => {
		fake.reconnectTimer = window.setTimeout(() => {}, 21750)
		Signaling.Standalone.prototype.k4Resume.call(fake, () => {})
		expect(fake.connect).toHaveBeenCalledTimes(1)
	})
})
