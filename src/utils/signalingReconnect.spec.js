/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#183, прогон 15.11): обрыв ≥15 с — сокет ждал «Reconnect in 21750», сервер за это время снял сессию

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { watch } from 'vue'
import CallView from '../components/CallView/CallView.vue'
import { k4net } from '../components/CallView/shared/k4peer.js'
import { calllog } from './calllog.js'
import Signaling, { K4_CALL_RECONNECT_MS, K4_FAST_RECONNECT_MS, K4_OPEN_TIMEOUT_MS, K4_RESUME_WINDOW_MS, k4ReconnectCap } from './signaling.js'

vi.mock('./calllog.js', () => ({ calllog: vi.fn(), calllogSession: vi.fn() }))

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
			send = vi.fn()
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

	test('a missing resume hello response retries with the same guest session', () => {
		const signaling = Object.assign(Object.create(Signaling.Standalone.prototype), {
			initialReconnectIntervalMs: 1000,
			maxReconnectIntervalMs: 16000,
			signalingConnectionError: null,
			signalingConnectionWarning: null,
			signalingConnectionTimeout: null,
			settings: { token: 'tok', helloAuthParams: {} },
			url: 'wss://x/spreed',
			currentRoomToken: 'tok',
			currentCallToken: 'tok',
			nextcloudSessionId: 'guest-room-session',
			sessionId: 'guest-session',
			resumeId: 'guest-resume',
			_trigger: vi.fn(),
			joinRoom: vi.fn(),
		})
		const openAndReadHello = (socket) => {
			socket.readyState = 1
			socket.onopen({})
			const hello = JSON.parse(socket.send.mock.calls[0][0])
			expect(hello.hello).toEqual({ version: '1.0', resumeid: 'guest-resume' })
			return hello.id
		}

		signaling.connect()
		const stalled = signaling.socket
		openAndReadHello(stalled)
		vi.advanceTimersByTime(6000)

		expect(stalled.close).toHaveBeenCalledOnce()
		const recovered = signaling.socket
		expect(recovered).not.toBe(stalled)
		const id = openAndReadHello(recovered)
		recovered.onmessage({
			data: {
				id,
				type: 'hello',
				hello: {
					sessionid: 'guest-session',
					resumeid: 'guest-resume',
					server: { features: ['audio-video-permissions', 'incall-all', 'switchto', 'federation'] },
				},
			},
		})
		vi.advanceTimersByTime(6000)

		expect(signaling.getSessionId()).toBe('guest-session')
		expect(signaling._trigger).toHaveBeenCalledWith('connect')
		expect(signaling.joinRoom).not.toHaveBeenCalled()
		expect(recovered.close).not.toHaveBeenCalled()
	})
})

function makeHelloSignal(resumeId = '') {
	return Object.assign(Object.create(Signaling.Standalone.prototype), {
		initialReconnectIntervalMs: 1000,
		maxReconnectIntervalMs: 16000,
		reconnectIntervalMs: 1000,
		signalingConnectionError: { hideToast: vi.fn() },
		signalingConnectionWarning: null,
		signalingConnectionTimeout: null,
		settings: { token: 'tok', helloAuthParams: {} },
		url: 'wss://x/spreed',
		currentRoomToken: 'tok',
		currentCallToken: 'tok',
		nextcloudSessionId: 'room-session',
		sessionId: resumeId ? 'guest-session' : '',
		resumeId,
		_trigger: vi.fn(),
		joinRoom: vi.fn(),
		_getBackendUrl: () => 'https://example.invalid/backend',
		hasFeature: () => true,
	})
}
function helloMessage(socket, sessionId, resumeId) {
	const sent = JSON.parse(socket.send.mock.calls.at(-1)[0])
	socket.onmessage({ data: { id: sent.id, type: 'hello', hello: { sessionid: sessionId, resumeid: resumeId, server: { features: ['audio-video-permissions', 'incall-all', 'switchto', 'federation'] } } } })
	return sent.id
}

// These assertions exercise the real CallView computed state and recovery logger, not a copied predicate.
test('resume timeout keeps loss visible and records one recovery only after accepted hello', async () => {
	vi.useFakeTimers()
	vi.stubGlobal('WebSocket', class {
		readyState = 0
		close = vi.fn()
		send = vi.fn()
	})
	calllog.mockClear()
	k4net.sigDown = true
	const vm = { k4net, k4offline: false, k4localWas: true, k4localNotConn: false, localCallParticipantModel: { attributes: { peerId: 'peer-old' } }, k4downAt: { t: Date.now() - 1000, peerId: 'peer-old' } }
	const stop = watch(() => CallView.computed.k4SelfLost.call(vm), CallView.watch.k4SelfLost.handler.bind(vm), { flush: 'sync' })
	const signaling = makeHelloSignal('guest-resume')
	signaling.connect()
	const stalled = signaling.socket
	stalled.readyState = 1
	stalled.onopen({})
	expect(k4net.sigDown).toBe(true)
	expect(calllog).not.toHaveBeenCalledWith('reconnect', expect.anything())
	await vi.advanceTimersByTimeAsync(6000)
	const recovered = signaling.socket
	expect(recovered).not.toBe(stalled)
	recovered.readyState = 1
	recovered.onopen({})
	expect(k4net.sigDown).toBe(true)
	expect(calllog).not.toHaveBeenCalledWith('reconnect', expect.anything())
	helloMessage(recovered, 'guest-session', 'guest-resume')
	expect(k4net.sigDown).toBe(false)
	expect(signaling.joinRoom).not.toHaveBeenCalled()
	expect(calllog.mock.calls.filter(([name]) => name === 'reconnect')).toHaveLength(1)
	expect(calllog).toHaveBeenCalledWith('reconnect', { ms: 7000, same: 1 })
	stop()
	vi.clearAllTimers()
	vi.unstubAllGlobals()
	vi.useRealTimers()
	k4net.sigDown = false
})

test('initial hello joins once; rejected resume stays down until fallback hello and ignores duplicate response', async () => {
	vi.useFakeTimers()
	vi.stubGlobal('WebSocket', class {
		readyState = 0
		close = vi.fn()
		send = vi.fn()
	})
	calllog.mockClear()
	k4net.sigDown = false
	// Initial, non-resume hello: join only after a valid hello; duplicate response id cannot join twice.
	const initial = makeHelloSignal('')
	initial.connect()
	const first = initial.socket
	first.readyState = 1
	first.onopen({})
	await vi.waitFor(() => expect(first.send).toHaveBeenCalledTimes(1))
	const firstId = helloMessage(first, 'first-session', 'first-resume')
	expect(initial.joinRoom).toHaveBeenCalledTimes(1)
	first.onmessage({ data: { id: firstId, type: 'hello', hello: { sessionid: 'first-session', resumeid: 'first-resume', server: { features: [] } } } })
	expect(initial.joinRoom).toHaveBeenCalledTimes(1)
	expect(initial._trigger.mock.calls.filter(([name]) => name === 'connect')).toHaveLength(1)

	// A rejected resume starts a fresh hello without clearing the down state; only its success recovers.
	const resumed = makeHelloSignal('old-resume')
	k4net.sigDown = true
	resumed.connect()
	const socket = resumed.socket
	socket.readyState = 1
	socket.onopen({})
	const rejected = JSON.parse(socket.send.mock.calls[0][0])
	expect(rejected.hello.resumeid).toBe('old-resume')
	const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
	socket.onmessage({ data: { id: rejected.id, type: 'error', error: { code: 'resume_expired' } } })
	errorSpy.mockRestore()
	await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2))
	expect(resumed.resumeId).toBe('')
	expect(k4net.sigDown).toBe(true)
	const fresh = JSON.parse(socket.send.mock.calls[1][0])
	expect(fresh.hello.auth).toBeTruthy()
	const freshId = helloMessage(socket, 'new-session', 'new-resume')
	expect(k4net.sigDown).toBe(false)
	expect(resumed.joinRoom).toHaveBeenCalledTimes(1)
	socket.onmessage({ data: { id: freshId, type: 'hello', hello: { sessionid: 'new-session', resumeid: 'new-resume', server: { features: ['audio-video-permissions', 'incall-all', 'switchto', 'federation'] } } } })
	expect(resumed.joinRoom).toHaveBeenCalledTimes(1)
	vi.clearAllTimers()
	vi.unstubAllGlobals()
	vi.useRealTimers()
	k4net.sigDown = false
})
