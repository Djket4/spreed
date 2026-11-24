/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, test, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { PARTICIPANT } from '../../constants.ts'
import { useSoundsStore } from '../../stores/sounds.js'
import EmitterMixin from '../../utils/EmitterMixin.js'
import VirtualBackground from '../../utils/media/pipeline/VirtualBackground.js'
import CallParticipantsAudioPlayer from '../../utils/webrtc/CallParticipantsAudioPlayer.js'
import { mediaDevicesManager } from '../../utils/webrtc/index.js'
import { useDevices } from '../useDevices.js'

let player

vi.mock('../../utils/webrtc/index.js', async () => {
	const { default: MediaDevicesManager } = await import('../../utils/webrtc/MediaDevicesManager.js')
	return {
		get callParticipantsAudioPlayer() { return player },
		mediaDevicesManager: new MediaDevicesManager(),
	}
})

afterEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

test('returns the active call to the default output when the selected device disappears', async () => {
	setActivePinia(createPinia())
	vi.spyOn(VirtualBackground, 'isSupported').mockReturnValue(false)
	vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
	vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
	const stream = {}
	vi.stubGlobal('AudioContext', class {
		createMediaStreamDestination() { return { stream } }
		close() {}
	})
	const selected = { kind: 'audiooutput', deviceId: 'selected', label: 'Selected output' }
	const additional = { kind: 'audiooutput', deviceId: 'additional', label: 'Additional output' }
	const mic = { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' }
	const mediaDevices = new EventTarget()
	mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([selected, mic])
	mediaDevices.getUserMedia = vi.fn()
	vi.stubGlobal('navigator', { mediaDevices })
	const participants = { callParticipantModels: [] }
	EmitterMixin.apply(participants)
	participants._superEmitterMixin()
	const scope = effectScope()
	const { subscribeToDevices, unsubscribeFromDevices } = scope.run(() => useDevices())
	const sounds = useSoundsStore()
	const permissions = PARTICIPANT.PERMISSIONS.PUBLISH_AUDIO | PARTICIPANT.PERMISSIONS.PUBLISH_VIDEO

	try {
		player = new CallParticipantsAudioPlayer(participants, true)
		subscribeToDevices(permissions, true)
		subscribeToDevices(permissions, true)
		await mediaDevicesManager._pendingEnumerateDevicesPromise
		expect(mediaDevicesManager.get('audioOutputId')).toBe(selected.deviceId)
		expect(HTMLAudioElement.prototype.setSinkId).toHaveBeenLastCalledWith(selected.deviceId)

		const setSinkId = vi.fn()
		player._audioElement.setSinkId = setSinkId
		mediaDevices.enumerateDevices.mockResolvedValue([additional, selected, mic])
		mediaDevices.dispatchEvent(new Event('devicechange'))
		await mediaDevicesManager._pendingEnumerateDevicesPromise
		expect(mediaDevicesManager.get('audioOutputId')).toBe(selected.deviceId)
		expect(setSinkId).not.toHaveBeenCalled()

		mediaDevices.enumerateDevices.mockResolvedValue([mic])
		mediaDevices.dispatchEvent(new Event('devicechange'))
		await mediaDevicesManager._pendingEnumerateDevicesPromise
		await nextTick()
		expect(mediaDevicesManager.get('audioOutputId')).toBeUndefined()
		expect(mediaDevicesManager.get('devices').map((device) => device.deviceId)).toEqual(['mic'])
		expect(setSinkId).toHaveBeenCalledExactlyOnceWith('')
		expect(player._audioElement.srcObject).toBe(stream)
		expect(sounds.audioObjects.join.setSinkId).toHaveBeenLastCalledWith('')
		expect(mediaDevices.getUserMedia).not.toHaveBeenCalled()

		mediaDevicesManager.isAudioOutputSelectSupported = false
		await player.setGeneralAudioOutput(additional.deviceId)
		expect(setSinkId).toHaveBeenCalledTimes(1)
	} finally {
		mediaDevicesManager.isAudioOutputSelectSupported = true
		unsubscribeFromDevices(permissions, true)
		unsubscribeFromDevices(permissions, true)
		scope.stop()
		player?.destroy()
		player = undefined
	}
})
