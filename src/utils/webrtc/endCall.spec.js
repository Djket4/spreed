/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import axios from '@nextcloud/axios'
import { afterEach, describe, expect, test, vi } from 'vitest'
import store from '../../store/index.js'
import Signaling from '../signaling.js'
import { initWebRtc } from './webrtc.js'

vi.mock('./simplewebrtc/simplewebrtc.js', () => ({
	default: class {
		roomName = 'call-token'
		on = vi.fn()
		webrtc = { on: vi.fn(), hasAudioTrack: () => false, hasVideoTrack: () => false }
		leaveCall = vi.fn(() => {
			this.roomName = undefined
		})
	},
}))
vi.mock('./LocalStateBroadcasterNoMcu.ts', () => ({
	LocalStateBroadcasterNoMcu: class {
		destroy = vi.fn()
	},
}))
vi.mock('../sounds.js', () => ({
	Sounds: { playLeave: vi.fn() },
}))

describe('HPB end for everyone', () => {
	const token = 'call-token'
	const participantUpdate = (signaling, update) => {
		Signaling.Standalone.prototype.processRoomParticipantsEvent.call(signaling, { event: { type: 'update', update } })
	}

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('leaves an unconfirmed local participant when the server ends the room call', async () => {
		const signaling = new Signaling.Base({})
		signaling.currentRoomToken = token
		const webRtc = initWebRtc(signaling, { callParticipantModels: [] }, {})
		const dispatch = vi.spyOn(store, 'dispatch').mockImplementation((_action, { token }) => {
			signaling.leaveCallLocally(token)
			return Promise.resolve()
		})
		const deletes = vi.spyOn(axios, 'delete')
		const pendingResponse = Promise.withResolvers()
		const post = vi.spyOn(axios, 'post').mockReturnValueOnce(pendingResponse.promise)
		const join = signaling.joinCall(token, 1, false, false, [])
		const rejected = expect(join).rejects.toMatchObject({ name: 'AbortError' })

		participantUpdate(signaling, { all: true, incall: 0, roomid: 'other-room' })
		expect(dispatch).not.toHaveBeenCalled()
		participantUpdate(signaling, { all: true, incall: 0, roomid: token })
		participantUpdate(signaling, { all: true, incall: 0, roomid: token })
		pendingResponse.resolve({})
		await rejected

		expect(dispatch).toHaveBeenCalledExactlyOnceWith('leaveCall', expect.objectContaining({ token, serverEnded: true }))
		expect(webRtc.leaveCall).toHaveBeenCalledOnce()
		expect(deletes).not.toHaveBeenCalled()
		expect(signaling.currentCallToken).toBeNull()

		post.mockResolvedValueOnce({})
		await signaling.joinCall(token, 1, false, false, [])
		expect(signaling.currentCallToken).toBe(token)
		signaling.leaveCallLocally(token)
	})
})
