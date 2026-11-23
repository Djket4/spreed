/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'vitest'
import { startK4speak } from './k4speak.js'
import { CallParticipantCollection } from './models/CallParticipantCollection.js'

const webRtc = { on: () => {}, off: () => {} }

describe('startK4speak (NAS_CLOUD#169)', () => {
	test('logs speaking changes with time, name and actor; closes the segment of a participant who leaves mid-sentence', () => {
		let t = 1000
		const target = {}
		const c = new CallParticipantCollection()
		const early = c.add({ peerId: 'p0', webRtc })
		early.set('name', 'Надя')
		early.setActor('users', 'nadya')
		startK4speak(c, target, () => t)

		const guest = c.add({ peerId: 'p1', webRtc })
		guest.set('name', 'Пётр')
		guest.setActor('guests', 'g1')

		t = 2000
		early.set('speaking', true)
		t = 2500
		guest.set('speaking', true)
		t = 3000
		early.set('speaking', false)
		t = 4000
		c.remove('p1')
		t = 5000
		guest.set('speaking', true) // после ухода — не пишем

		expect(target.__k4speak.t0).toBe(1000)
		expect(target.__k4speak.events).toEqual([
			{ t: 2000, peer: 'p0', actor: 'users/nadya', name: 'Надя', speaking: true },
			{ t: 2500, peer: 'p1', actor: 'guests/g1', name: 'Пётр', speaking: true },
			{ t: 3000, peer: 'p0', actor: 'users/nadya', name: 'Надя', speaking: false },
			{ t: 4000, peer: 'p1', actor: 'guests/g1', name: 'Пётр', speaking: false },
		])
	})
})
