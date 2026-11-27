/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#183, прогон 15.11): обрыв ≥15 с — сокет ждал «Reconnect in 21750», сервер за это время снял сессию

import axios from '@nextcloud/axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import store from '../store/index.js'
import * as calllog from './calllog.js'
import Signaling, { K4_CALL_LEAVE_DELETE_TIMEOUT_MS, K4_CALL_LEAVE_JOIN_WAIT_MS, K4_CALL_RECONNECT_MS, K4_FAST_RECONNECT_MS, K4_OPEN_TIMEOUT_MS, K4_RESUME_WINDOW_MS, k4ReconnectCap } from './signaling.js'

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

describe('leaving during automatic call rejoin', () => {
	const token = 'call-token'
	const sessionId = 'talk-session'
	const callFlags = 3

	const makeSignaling = () => {
		const signaling = new Signaling.Base({ helloAuthParams: {} })
		signaling.currentRoomToken = token
		signaling.nextcloudSessionId = sessionId
		signaling.currentCallToken = token
		signaling.currentCallFlags = callFlags
		signaling.currentCallSilent = true
		signaling.currentCallRecordingConsent = true
		signaling.currentCallSilentFor = ['users/observer']
		return signaling
	}

	const watchEvents = (signaling) => {
		const beforeLeave = vi.fn()
		const joined = vi.fn()
		const left = vi.fn()
		const joinFailed = vi.fn()
		signaling.on('beforeLeaveCall', beforeLeave)
		signaling.on('joinCall', joined)
		signaling.on('leaveCall', left)
		signaling.on('joinCallFailed', joinFailed)
		return { beforeLeave, joined, left, joinFailed }
	}

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	test.each([true, false])('explicit leave follows the rejoin POST when applied before leave intent is %s', async (postAppliedBeforeLeave) => {
		const signaling = makeSignaling()
		const events = watchEvents(signaling)
		const response = Promise.withResolvers()
		const serverMutations = []
		const applyPost = () => serverMutations.push(callFlags)
		const post = vi.spyOn(axios, 'post').mockReturnValueOnce(response.promise)
		const remove = vi.spyOn(axios, 'delete').mockImplementationOnce(async () => {
			serverMutations.push(0)
			return {}
		})

		await signaling.joinRoom(token, sessionId)
		expect(post).toHaveBeenCalledOnce()
		if (postAppliedBeforeLeave) {
			applyPost()
		}
		const leave = signaling.leaveCall(token, false)
		expect(events.beforeLeave).toHaveBeenCalledExactlyOnceWith(token, false)
		expect(signaling.currentCallToken).toBeNull()
		await Promise.resolve()
		expect(remove).not.toHaveBeenCalled()

		if (!postAppliedBeforeLeave) {
			applyPost()
		}
		response.resolve({})
		await leave

		expect(remove).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/call/' + token), expect.objectContaining({ data: { all: false } }))
		expect(serverMutations).toEqual([callFlags, 0])
		expect(events.joined).not.toHaveBeenCalled()
		expect(events.joinFailed).not.toHaveBeenCalled()
		expect(events.left).toHaveBeenCalledExactlyOnceWith(token, false)
		expect(signaling.currentCallToken).toBeNull()
		expect(signaling.currentCallFlags).toBeNull()
		expect(signaling.currentRoomToken).toBe(token)
		expect(signaling.nextcloudSessionId).toBe(sessionId)
	})

	test('a fresh intentional join waits until the earlier leave completes', async () => {
		const signaling = makeSignaling()
		const oldPost = Promise.withResolvers()
		const deleteResponse = Promise.withResolvers()
		const deleteStarted = Promise.withResolvers()
		const post = vi.spyOn(axios, 'post').mockReturnValueOnce(oldPost.promise).mockResolvedValueOnce({})
		const remove = vi.spyOn(axios, 'delete').mockImplementationOnce(() => {
			deleteStarted.resolve()
			return deleteResponse.promise
		})
		const events = watchEvents(signaling)

		await signaling.joinRoom(token, sessionId)
		const leave = signaling.leaveCall(token, false, true)
		const join = signaling.joinCall(token, 1, false, false, [])
		oldPost.resolve({})
		await deleteStarted.promise
		expect(post).toHaveBeenCalledOnce()
		expect(events.joined).not.toHaveBeenCalled()
		expect(remove).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/call/' + token), expect.objectContaining({ data: { all: true } }))

		deleteResponse.resolve({})
		await Promise.all([leave, join])
		expect(post).toHaveBeenCalledTimes(2)
		expect(events.left).toHaveBeenCalledExactlyOnceWith(token, false)
		expect(events.joined).toHaveBeenCalledExactlyOnceWith(token, 1)
		expect(signaling.currentCallToken).toBe(token)
		expect(signaling.currentCallFlags).toBe(1)
	})

	test('the HPB room acknowledgment cannot start a queued rejoin after explicit leave', async () => {
		const signaling = Object.setPrototypeOf(makeSignaling(), Signaling.Standalone.prototype)
		signaling.sessionId = 'hpb-session'
		const send = vi.spyOn(signaling, 'doSend').mockImplementation(() => {})
		const post = vi.spyOn(axios, 'post').mockResolvedValueOnce({})
		const remove = vi.spyOn(axios, 'delete').mockResolvedValueOnce({})

		await signaling.joinRoom(token, sessionId)
		expect(send).toHaveBeenCalledOnce()
		expect(post).not.toHaveBeenCalled()
		await signaling.leaveCurrentCall()
		send.mock.calls[0][1]({ type: 'room' })

		expect(post).not.toHaveBeenCalled()
		expect(remove).toHaveBeenCalledOnce()
		expect(signaling.currentRoomToken).toBe(token)
		expect(signaling.signalingRoomJoined).toBe(token)
		expect(signaling.currentCallToken).toBeNull()
	})

	test.each([false, true])('automatic rejoin preserves call parameters with a reconnect leave set to %s', async (keepToken) => {
		const signaling = makeSignaling()
		const events = watchEvents(signaling)
		const response = Promise.withResolvers()
		const post = vi.spyOn(axios, 'post').mockReturnValueOnce(response.promise)
		const remove = vi.spyOn(axios, 'delete').mockResolvedValueOnce({})

		await signaling.joinRoom(token, sessionId)
		if (keepToken) {
			await signaling.leaveCall(token, true)
			expect(events.left).toHaveBeenCalledExactlyOnceWith(token, true)
			expect(remove).toHaveBeenCalledOnce()
		} else {
			expect(remove).not.toHaveBeenCalled()
		}
		const joined = Promise.withResolvers()
		signaling.on('joinCall', joined.resolve)
		response.resolve({})
		await joined.promise

		expect(post).toHaveBeenCalledOnce()
		expect(events.joined).toHaveBeenCalledExactlyOnceWith(token, callFlags)
		expect(signaling.currentCallToken).toBe(token)
		expect(signaling.currentCallFlags).toBe(callFlags)
		expect(signaling.currentCallSilent).toBe(true)
		expect(signaling.currentCallRecordingConsent).toBe(true)
		expect(signaling.currentCallSilentFor).toEqual(['users/observer'])
	})

	test('a lost rejoin response still lets explicit leave attempt DELETE', async () => {
		const signaling = makeSignaling()
		const events = watchEvents(signaling)
		const response = Promise.withResolvers()
		vi.spyOn(axios, 'post').mockReturnValueOnce(response.promise)
		const remove = vi.spyOn(axios, 'delete').mockResolvedValueOnce({})

		await signaling.joinRoom(token, sessionId)
		const leave = signaling.leaveCall(token, false)
		response.reject(new Error('Network Error'))
		await leave

		expect(remove).toHaveBeenCalledOnce()
		expect(events.joined).not.toHaveBeenCalled()
		expect(events.joinFailed).not.toHaveBeenCalled()
		expect(events.left).toHaveBeenCalledExactlyOnceWith(token, false)
	})

	test('a stuck rejoin POST still lets explicit leave attempt one DELETE', async () => {
		vi.useFakeTimers()
		const signaling = makeSignaling()
		const events = watchEvents(signaling)
		const response = Promise.withResolvers()
		const post = vi.spyOn(axios, 'post').mockReturnValueOnce(response.promise)
		const remove = vi.spyOn(axios, 'delete').mockResolvedValueOnce({})

		await signaling.joinRoom(token, sessionId)
		const leave = signaling.leaveCall(token, false)
		const signal = post.mock.calls[0][2].signal
		await vi.advanceTimersByTimeAsync(K4_CALL_LEAVE_JOIN_WAIT_MS - 1)
		expect(remove).not.toHaveBeenCalled()
		expect(signal.aborted).toBe(false)

		await vi.advanceTimersByTimeAsync(1)
		await leave
		expect(signal.aborted).toBe(true)
		expect(remove).toHaveBeenCalledOnce()
		expect(events.left).toHaveBeenCalledExactlyOnceWith(token, false)

		response.resolve({})
		await vi.advanceTimersByTimeAsync(0)
		expect(events.joined).not.toHaveBeenCalled()
		expect(events.joinFailed).not.toHaveBeenCalled()
		expect(signaling.currentCallToken).toBeNull()
		expect(remove).toHaveBeenCalledOnce()
	})

	test('stuck POST and DELETE responses allow local exit and a fresh same-room join within the total deadline', async () => {
		vi.useFakeTimers()
		const signaling = makeSignaling()
		const events = watchEvents(signaling)
		const rejoinResponse = Promise.withResolvers()
		const leaveResponse = Promise.withResolvers()
		const post = vi.spyOn(axios, 'post').mockReturnValueOnce(rejoinResponse.promise).mockResolvedValueOnce({})
		const remove = vi.spyOn(axios, 'delete').mockReturnValueOnce(leaveResponse.promise)

		await signaling.joinRoom(token, sessionId)
		const leave = signaling.leaveCall(token, false)
		const timedOut = expect(leave).rejects.toMatchObject({ cause: { name: 'TimeoutError' } })
		const join = signaling.joinCall(token, 1, false, false, [])
		await vi.advanceTimersByTimeAsync(K4_CALL_LEAVE_JOIN_WAIT_MS + K4_CALL_LEAVE_DELETE_TIMEOUT_MS - 1)
		const deleteSignal = remove.mock.calls[0][1].signal
		expect(post).toHaveBeenCalledOnce()
		expect(deleteSignal.aborted).toBe(false)
		expect(events.left).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(1)
		await Promise.all([timedOut, join])
		expect(deleteSignal.aborted).toBe(true)
		expect(events.left).toHaveBeenCalledExactlyOnceWith(token, false)
		expect(events.joined).toHaveBeenCalledExactlyOnceWith(token, 1)

		rejoinResponse.resolve({})
		leaveResponse.resolve({})
		await vi.advanceTimersByTimeAsync(0)
		expect(remove).toHaveBeenCalledOnce()
		expect(post).toHaveBeenCalledTimes(2)
		expect(events.left).toHaveBeenCalledOnce()
		expect(events.joined).toHaveBeenCalledOnce()
		expect(signaling.currentCallToken).toBe(token)
		expect(signaling.currentCallFlags).toBe(1)
	})

	test.each(['forced reconnect', 'invalid-session recovery'])('an acknowledged rejoin on the replacement session is left after %s', async (recovery) => {
		const signaling = Object.setPrototypeOf(makeSignaling(), Signaling.Standalone.prototype)
		signaling.connected = true
		signaling.sessionId = 'hpb-session'
		signaling.signalingRoomJoined = token
		vi.spyOn(signaling, 'doSend').mockImplementation(() => {})
		vi.spyOn(calllog, 'calllogSession').mockImplementation(() => {})
		const events = watchEvents(signaling)
		const rejoinResponse = Promise.withResolvers()
		const replacementSession = 'replacement-session'
		const callFlagsBySession = { [sessionId]: callFlags, [replacementSession]: 0 }
		let serverSession = sessionId
		const post = vi.spyOn(axios, 'post').mockReturnValueOnce(rejoinResponse.promise)
		const remove = vi.spyOn(axios, 'delete').mockImplementationOnce(async () => {
			callFlagsBySession[serverSession] = 0
			return {}
		})

		await signaling.joinRoom(token, sessionId)
		expect(post).toHaveBeenCalledOnce()
		const leave = signaling.leaveCall(token, false)
		expect(remove).not.toHaveBeenCalled()

		callFlagsBySession[sessionId] = 0
		serverSession = replacementSession
		if (recovery === 'forced reconnect') {
			const handoff = Promise.withResolvers()
			vi.spyOn(signaling, 'sendBye').mockImplementation(() => handoff.resolve())
			post.mockResolvedValueOnce({ data: { ocs: { data: { sessionId: replacementSession } } } })
			signaling.forceReconnect(true)
			await handoff.promise
		} else {
			const dispatch = vi.spyOn(store, 'dispatch').mockImplementationOnce((_action, { token, rejoinFromSessionId }) => {
				return signaling.joinRoom(token, replacementSession, rejoinFromSessionId)
			})
			signaling.processErrorNoSuchRoom()
			expect(dispatch).toHaveBeenCalledExactlyOnceWith('joinConversation', { token, rejoinFromSessionId: sessionId })
			await dispatch.mock.results[0].value
		}
		expect(signaling.nextcloudSessionId).toBe(replacementSession)

		// The server resolves the old call POST against the current room session.
		callFlagsBySession[serverSession] = callFlags
		rejoinResponse.resolve({})
		await leave

		expect(remove).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/call/' + token), expect.objectContaining({ data: { all: false } }))
		expect(callFlagsBySession).toEqual({ [sessionId]: 0, [replacementSession]: 0 })
		expect(events.left).toHaveBeenCalledExactlyOnceWith(token, false)
		expect(events.joined).not.toHaveBeenCalled()
		expect(signaling.currentCallToken).toBeNull()
		expect(signaling.currentRoomToken).toBe(token)
	})

	test('a delayed leave skips DELETE after an independent same-room takeover', async () => {
		vi.useFakeTimers()
		const signaling = makeSignaling()
		const events = watchEvents(signaling)
		const response = Promise.withResolvers()
		vi.spyOn(axios, 'post').mockReturnValueOnce(response.promise)
		const remove = vi.spyOn(axios, 'delete').mockResolvedValueOnce({})

		await signaling.joinRoom(token, sessionId)
		const leave = signaling.leaveCall(token, false)
		const skipped = expect(leave).rejects.toMatchObject({ cause: { message: 'Call leave no longer owns this session' } })
		await signaling.joinRoom(token, 'replacement-session')
		await vi.advanceTimersByTimeAsync(K4_CALL_LEAVE_JOIN_WAIT_MS)
		await skipped
		expect(remove).not.toHaveBeenCalled()
		expect(events.left).toHaveBeenCalledExactlyOnceWith(token, false)
		expect(signaling.nextcloudSessionId).toBe('replacement-session')
		expect(signaling.currentCallToken).toBeNull()

		response.resolve({})
		await vi.advanceTimersByTimeAsync(0)
		expect(events.joined).not.toHaveBeenCalled()
	})

	test('an independent takeover followed by manual join keeps the newer call active', async () => {
		const signaling = makeSignaling()
		const events = watchEvents(signaling)
		const rejoinResponse = Promise.withResolvers()
		const independentSession = 'independent-session'
		let serverCallFlags = 0
		const post = vi.spyOn(axios, 'post').mockReturnValueOnce(rejoinResponse.promise).mockImplementationOnce(async () => {
			serverCallFlags = 1
			return {}
		})
		const remove = vi.spyOn(axios, 'delete').mockImplementationOnce(async () => {
			serverCallFlags = 0
			return {}
		})

		await signaling.joinRoom(token, sessionId)
		const leave = signaling.leaveCall(token, false)
		const skipped = expect(leave).rejects.toMatchObject({ cause: { message: 'Call leave no longer owns this session' } })
		await signaling.joinRoom(token, 'automatic-session', sessionId)
		await signaling.joinRoom(token, independentSession)
		const manualJoin = signaling.joinCall(token, 1, false, false, [])
		expect(post).toHaveBeenCalledOnce()
		serverCallFlags = callFlags
		rejoinResponse.resolve({})
		await Promise.all([skipped, manualJoin])

		expect(remove).not.toHaveBeenCalled()
		expect(post).toHaveBeenCalledTimes(2)
		expect(serverCallFlags).toBe(1)
		expect(events.left).toHaveBeenCalledExactlyOnceWith(token, false)
		expect(events.joined).toHaveBeenCalledExactlyOnceWith(token, 1)
		expect(signaling.nextcloudSessionId).toBe(independentSession)
		expect(signaling.currentCallToken).toBe(token)
	})

	test('a timed-out DELETE does not locally leave a different call joined in the meantime', async () => {
		vi.useFakeTimers()
		const signaling = makeSignaling()
		const events = watchEvents(signaling)
		const response = Promise.withResolvers()
		vi.spyOn(axios, 'post').mockResolvedValueOnce({})
		const remove = vi.spyOn(axios, 'delete').mockReturnValueOnce(response.promise)

		const leave = signaling.leaveCall(token, false)
		const timedOut = expect(leave).rejects.toMatchObject({ cause: { name: 'TimeoutError' } })
		await vi.advanceTimersByTimeAsync(0)
		expect(remove).toHaveBeenCalledOnce()
		await signaling.joinRoom('different-call', 'different-session')
		await signaling.joinCall('different-call', 1, false, false, [])
		await vi.advanceTimersByTimeAsync(K4_CALL_LEAVE_DELETE_TIMEOUT_MS)
		await timedOut

		response.resolve({})
		await vi.advanceTimersByTimeAsync(0)
		expect(events.left).not.toHaveBeenCalled()
		expect(events.joined).toHaveBeenCalledExactlyOnceWith('different-call', 1)
		expect(remove).toHaveBeenCalledOnce()
		expect(signaling.currentCallToken).toBe('different-call')
	})
})
