/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#183, прогон 15.11): обрыв ≥15 с — сокет ждал «Reconnect in 21750», сервер за это время снял сессию

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Signaling, { K4_CALL_RECONNECT_MS, K4_FAST_RECONNECT_MS, K4_OPEN_TIMEOUT_MS, K4_RESUME_WINDOW_MS, k4ReconnectCap } from './signaling.js'

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

	test('прогон 15.11 №2: in a call the delay stays 3–5 s after the 30 s window (was 15.8 s)', () => {
		delay()
		vi.advanceTimersByTime(K4_RESUME_WINDOW_MS + 1000)
		fake.currentCallToken = 'tok'
		fake.reconnectIntervalMs = 16000
		const ms = delay()
		expect(ms).toBeLessThanOrEqual(K4_CALL_RECONNECT_MS)
		expect(ms).toBeGreaterThanOrEqual(3000)
	})

	test('k4ReconnectCap keeps jitter', () => {
		expect(k4ReconnectCap(16000, 40000, true, 0)).toBe(3000)
		expect(k4ReconnectCap(16000, 40000, true, 1)).toBe(5000)
		expect(k4ReconnectCap(16000, 1000, true, 0)).toBe(1000)
		expect(k4ReconnectCap(16000, 40000, false, 0)).toBe(16000)
	})
})

describe('прогон 15.11 №2, ice 8 с: попытка сокета зависла в CONNECTING на 15 с', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.stubGlobal('WebSocket', class {
			readyState = 0
			close = vi.fn()
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	const make = () => ({
		signalingConnectionError: {},
		signalingConnectionWarning: {},
		settings: { token: 'tok', helloAuthParams: {} },
		url: 'wss://x/spreed',
		callbacks: {},
		reconnect: vi.fn(),
	})

	test('socket that does not open in time is dropped and the reconnect starts', () => {
		const fake = make()
		Signaling.Standalone.prototype.connect.call(fake)
		const sock = fake.socket
		vi.advanceTimersByTime(K4_OPEN_TIMEOUT_MS)
		expect(sock.close).toHaveBeenCalled()
		expect(fake.socket).toBe(null)
		expect(fake.reconnect).toHaveBeenCalledTimes(1)
	})

	test('socket that opened in time is left alone', () => {
		const fake = make()
		Signaling.Standalone.prototype.connect.call(fake)
		fake.socket.readyState = 1
		vi.advanceTimersByTime(K4_OPEN_TIMEOUT_MS)
		expect(fake.reconnect).not.toHaveBeenCalled()
	})
})
