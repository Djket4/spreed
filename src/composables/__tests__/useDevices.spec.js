/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, test, vi } from 'vitest'
import { effectScope, markRaw, nextTick } from 'vue'
import MediaSettings from '../../components/MediaSettings/MediaSettings.vue'
import { PARTICIPANT } from '../../constants.ts'
import { useSoundsStore } from '../../stores/sounds.js'
import EmitterMixin from '../../utils/EmitterMixin.js'
import MediaDevicesSource from '../../utils/media/pipeline/MediaDevicesSource.js'
import VirtualBackground from '../../utils/media/pipeline/VirtualBackground.js'
import CallParticipantsAudioPlayer from '../../utils/webrtc/CallParticipantsAudioPlayer.js'
import { mediaDevicesManager } from '../../utils/webrtc/index.js'
import { useDevices } from '../useDevices.js'

let player

vi.mock('../../components/TopBar/CallButton.vue', () => ({ default: {} }))

vi.mock('../../utils/media/effects/virtual-background/VideoStreamBackgroundEffect.js', () => ({
	default: class {
		load() { return Promise.resolve() }
		destroy() {}
	},
}))

vi.mock('hark', () => ({
	default: () => ({ on: vi.fn(), off: vi.fn(), stop: vi.fn() }),
}))

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
	const { audioOutputDevices, audioOutputId, subscribeToDevices, unsubscribeFromDevices } = scope.run(() => useDevices())
	const sounds = useSoundsStore()
	const permissions = PARTICIPANT.PERMISSIONS.PUBLISH_AUDIO | PARTICIPANT.PERMISSIONS.PUBLISH_VIDEO

	try {
		player = new CallParticipantsAudioPlayer(participants, true)
		subscribeToDevices(permissions, true)
		subscribeToDevices(permissions, true)
		await mediaDevicesManager._pendingEnumerateDevicesPromise
		expect(audioOutputId.value).toBe('')
		expect(audioOutputDevices.value.map((device) => device.deviceId)).toEqual(['', selected.deviceId])
		expect(HTMLAudioElement.prototype.setSinkId).not.toHaveBeenCalledWith(selected.deviceId)

		mediaDevices.enumerateDevices.mockResolvedValue([
			{ kind: 'audiooutput', deviceId: 'default', label: 'Default – additional' },
			additional,
			selected,
			mic,
		])
		mediaDevices.dispatchEvent(new Event('devicechange'))
		await mediaDevicesManager._pendingEnumerateDevicesPromise
		expect(audioOutputId.value).toBe('')
		expect(audioOutputDevices.value.map((device) => device.deviceId)).toEqual(['', selected.deviceId, additional.deviceId])
		expect(HTMLAudioElement.prototype.setSinkId).not.toHaveBeenCalledWith(additional.deviceId)

		audioOutputId.value = selected.deviceId
		await nextTick()
		expect(mediaDevicesManager.get('audioOutputId')).toBe(selected.deviceId)
		expect(HTMLAudioElement.prototype.setSinkId).toHaveBeenLastCalledWith(selected.deviceId)

		const setSinkId = vi.fn()
		player._audioElement.setSinkId = setSinkId
		mediaDevices.enumerateDevices.mockResolvedValue([additional, selected, mic])
		mediaDevices.dispatchEvent(new Event('devicechange'))
		await mediaDevicesManager._pendingEnumerateDevicesPromise
		expect(mediaDevicesManager.get('audioOutputId')).toBe(selected.deviceId)
		expect(setSinkId).not.toHaveBeenCalled()

		mediaDevices.enumerateDevices.mockResolvedValue([additional, mic])
		mediaDevices.dispatchEvent(new Event('devicechange'))
		await mediaDevicesManager._pendingEnumerateDevicesPromise
		await nextTick()
		expect(mediaDevicesManager.get('audioOutputId')).toBe('')
		expect(mediaDevicesManager.get('devices').map((device) => device.deviceId)).toEqual([mic.deviceId, additional.deviceId])
		expect(setSinkId).toHaveBeenCalledExactlyOnceWith('')
		expect(player._audioElement.srcObject).toBe(stream)
		expect(sounds.audioObjects.join.setSinkId).toHaveBeenLastCalledWith('')
		expect(mediaDevices.getUserMedia).not.toHaveBeenCalled()

		mediaDevicesManager.isAudioOutputSelectSupported = false
		await player.setGeneralAudioOutput(additional.deviceId)
		expect(setSinkId).toHaveBeenCalledTimes(1)
	} finally {
		audioOutputId.value = ''
		mediaDevicesManager.isAudioOutputSelectSupported = true
		unsubscribeFromDevices(permissions, true)
		unsubscribeFromDevices(permissions, true)
		scope.stop()
		player?.destroy()
		player = undefined
	}
})

function mockTrack(kind) {
	return Object.assign(new EventTarget(), {
		kind,
		stop: vi.fn(),
		getSettings: () => ({ deviceId: `${kind}-device` }),
	})
}

function mockStream(...tracks) {
	return markRaw({
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
		getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
	})
}

test.each([
	{ scenario: 'close without reopening', earlyKind: null, reopen: false },
	{ scenario: 'only audio was ready before reopening', earlyKind: 'audio', reopen: true },
	{ scenario: 'only video was ready before reopening', earlyKind: 'video', reopen: true },
	{ scenario: 'both tracks arrive after reopening', earlyKind: null, reopen: true },
	{ scenario: 'both requests fail after reopening', earlyKind: null, reopen: true, denied: true },
])('releases the closed preview during a call when $scenario', async ({ earlyKind, reopen, denied }) => {
	setActivePinia(createPinia())
	vi.spyOn(VirtualBackground, 'isSupported').mockReturnValue(false)
	vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
	const mediaDevices = new EventTarget()
	mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([
		{ kind: 'audioinput', deviceId: 'audio-device', label: 'Microphone' },
		{ kind: 'videoinput', deviceId: 'video-device', label: 'Camera' },
	])
	mediaDevices.getUserMedia = vi.fn()
	vi.stubGlobal('navigator', { mediaDevices })

	const scope = effectScope()
	const devices = scope.run(() => useDevices())
	const permissions = PARTICIPANT.PERMISSIONS.MAX_DEFAULT
	const call = new MediaDevicesSource()
	const callAudio = mockTrack('audio')
	const callVideo = mockTrack('video')
	const oldAudio = mockTrack('audio')
	const oldVideo = mockTrack('video')
	const freshAudio = mockTrack('audio')
	const freshVideo = mockTrack('video')
	const oldRequests = { audio: Promise.withResolvers(), video: Promise.withResolvers() }
	const oldStreams = { audio: mockStream(oldAudio), video: mockStream(oldVideo) }
	const freshStreams = { audio: mockStream(freshAudio), video: mockStream(freshVideo) }
	const requests = { audio: 0, video: 0 }
	const capture = vi.spyOn(mediaDevicesManager, 'getUserMedia').mockImplementation((constraints, source) => {
		if (source === 'callstart') {
			return Promise.resolve(mockStream(callAudio, callVideo))
		}
		const kind = constraints.audio ? 'audio' : 'video'
		requests[kind]++
		return requests[kind] === 1 ? oldRequests[kind].promise : Promise.resolve(freshStreams[kind])
	})

	const panel = {
		show: false,
		guestNameStore: { guestUserName: '' },
		settingsStore: { startWithoutMedia: true },
		$nextTick: nextTick,
		clearVirtualBackground: vi.fn(),
		updatePreferences: devices.updatePreferences,
		registerVideoElement: devices.registerVideoElement,
		subscribeToDevices: devices.subscribeToDevices,
		unsubscribeFromDevices: devices.unsubscribeFromDevices,
		close: MediaSettings.methods.close,
	}
	const openPreview = () => {
		MediaSettings.methods.showMediaSettings.call(panel, 'device-check')
		MediaSettings.watch.show.call(panel, true)
	}
	const closePreview = async () => {
		MediaSettings.methods.handleDialogClose.call(panel)
		await nextTick()
	}

	try {
		// The two lower call controls share the device list. The call owns its
		// own input tracks, while the device panel owns the preview tracks.
		devices.subscribeToDevices(permissions, true)
		devices.subscribeToDevices(permissions, true)
		await mediaDevicesManager._pendingEnumerateDevicesPromise
		await call.start()
		expect(capture).toHaveBeenCalledTimes(1)
		openPreview()
		expect(requests).toEqual({ audio: 1, video: 1 })

		if (earlyKind) {
			oldRequests[earlyKind].resolve(oldStreams[earlyKind])
			await flushPromises()
			expect(devices[`${earlyKind}Stream`].value).toBe(oldStreams[earlyKind])
		}

		await closePreview()
		if (reopen) {
			openPreview()
			expect(requests.audio).toBe(earlyKind === 'audio' ? 2 : 1)
			expect(requests.video).toBe(earlyKind === 'video' ? 2 : 1)
		}
		for (const kind of ['audio', 'video']) {
			if (denied) {
				oldRequests[kind].reject(new DOMException('Permission denied', 'NotAllowedError'))
			} else {
				oldRequests[kind].resolve(oldStreams[kind])
			}
		}
		await flushPromises()

		expect(oldAudio.stop).toHaveBeenCalledTimes(denied ? 0 : 1)
		expect(oldVideo.stop).toHaveBeenCalledTimes(denied ? 0 : 1)
		expect(call.getOutputTrack('audio')).toBe(callAudio)
		expect(call.getOutputTrack('video')).toBe(callVideo)
		expect(callAudio.stop).not.toHaveBeenCalled()
		expect(callVideo.stop).not.toHaveBeenCalled()
		expect(devices.audioStream.value).toBe(reopen ? freshStreams.audio : null)
		expect(devices.videoStream.value).toBe(reopen ? freshStreams.video : null)
		expect(devices.audioStreamError.value).toBeNull()
		expect(devices.videoStreamError.value).toBeNull()
		const requestCount = reopen ? 2 : 1
		expect(requests).toEqual({ audio: requestCount, video: requestCount })

		if (!reopen) {
			call.stop()
			capture.mockResolvedValueOnce(mockStream(freshAudio, freshVideo))
			await call.start()
			expect(call.getOutputTrack('audio')).toBe(freshAudio)
			expect(call.getOutputTrack('video')).toBe(freshVideo)
		}
	} finally {
		if (panel.show) {
			await closePreview()
		}
		call.stop()
		devices.unsubscribeFromDevices(permissions, true)
		devices.unsubscribeFromDevices(permissions, true)
		scope.stop()
	}
})
