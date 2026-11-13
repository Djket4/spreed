/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#154): флаг просьбы включить микрофон

import { beforeEach, describe, expect, test } from 'vitest'
import { LocalCallParticipantModel } from './LocalCallParticipantModel.js'

function fakeWebRtc() {
	const handlers = {}

	return {
		connection: { getSessionId: () => 'me' },
		on: (ev, fn) => { handlers[ev] = fn },
		off: (ev) => { delete handlers[ev] },
		emit: (ev) => handlers[ev]?.(),
	}
}

describe('LocalCallParticipantModel askUnmute flag', () => {
	let model
	let webRtc

	beforeEach(() => {
		model = new LocalCallParticipantModel()
		webRtc = fakeWebRtc()
		model.setWebRtc(webRtc)
	})

	test('set by askUnmute, reset when the microphone gets enabled', () => {
		webRtc.emit('askUnmute')
		expect(model.get('askUnmute')).toBe(true)
		webRtc.emit('audioOn')
		expect(model.get('askUnmute')).toBe(false)
	})

	test('reset for a new session', () => {
		webRtc.emit('askUnmute')
		model.setWebRtc(fakeWebRtc())
		expect(model.get('askUnmute')).toBe(false)
	})
})
