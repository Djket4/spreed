/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#154): «control» (forceMute/askUnmute) принимаем только по серверному каналу control

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Signaling from './signaling.js'

describe('Standalone signaling: control messages', () => {
	let fake

	beforeEach(() => {
		vi.stubGlobal('WebSocket', class {})
		fake = {
			signalingConnectionError: {},
			signalingConnectionWarning: {},
			settings: { token: 'tok', helloAuthParams: {} },
			url: 'wss://x/spreed',
			callbacks: {},
			_trigger: vi.fn(),
		}
		Signaling.Standalone.prototype.connect.call(fake)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	const receive = (data) => fake.socket.onmessage({ data })

	test('askUnmute from a plain message (guest) is ignored', () => {
		receive({ type: 'message', message: { sender: { sessionid: 'guest' }, data: { type: 'control', payload: { action: 'askUnmute', peerId: 'me' } } } })
		expect(fake._trigger).not.toHaveBeenCalledWith('message', expect.anything())
	})

	test('askUnmute via the server control channel is delivered', () => {
		receive({ type: 'control', control: { sender: { sessionid: 'mod' }, data: { action: 'askUnmute', peerId: 'me' } } })
		expect(fake._trigger).toHaveBeenCalledWith('message', [{ type: 'control', payload: { action: 'askUnmute', peerId: 'me' }, from: 'mod' }])
	})

	test('ordinary plain messages are still delivered', () => {
		receive({ type: 'message', message: { sender: { sessionid: 'a' }, data: { type: 'raiseHand', payload: true } } })
		expect(fake._trigger).toHaveBeenCalledWith('message', [expect.objectContaining({ type: 'raiseHand', from: 'a' })])
	})
})
