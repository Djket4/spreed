/**
 * SPDX-FileCopyrightText: 2021 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { isChromium } from '../../browserCheck.ts'
import { mediaDevicesManager } from '../../webrtc/index.js'
import TrackSource from './TrackSource.js'

/**
 * ket4tec (NAS_CLOUD#239): стартовый размер камеры вне Chromium = качество HIGH из VideoConstrainer, но без
 * нижних границ (камера ниже 720p не должна отказывать). Без этого Safari открывает камеру в 640x480,
 * следом ограничитель качества переключает её на 1080p, и на iPhone кадр дёргается и меняет масштаб.
 * Те же значения у превью проверки устройств (useDevices): камера одна на все треки страницы.
 */
export const START_VIDEO_CONSTRAINTS = Object.freeze({
	width: { ideal: 1920, max: 1920 },
	height: { ideal: 1080, max: 1080 },
	frameRate: { ideal: 30, max: 30 },
	resizeMode: 'none',
})

/**
 * Source node to get audio and video tracks from MediaDevicesManager.
 *
 * Two output tracks with "audio" and "video" as ids are provided.
 *
 * The source is started by calling "start(retryNoVideoCallback)". Whether the
 * audio track, video track or both start depends on the allowed media and the
 * current devices. Even if no track is started at first the node will listen to
 * changes in the audioInputId and videoInputId attributes from the
 * MediaDevicesManager and start, stop and replace the tracks are needed.
 *
 * The allowed media can be set with "setAudioAllowed(bool)" and
 * "setVideoAllowed(bool)". If the audioInputId or videoInputId changed but that
 * media is currently not allowed the change will be ignored. Allowing or
 * disallowing media will automatically start or stop the tracks as needed.
 *
 * Once the source is started "stop()" needs to be called to stop listening to
 * changes in the devices. Stopping the source also stops any track currently
 * active.
 *
 *        --------------------
 *       |                    | --->
 *       | MediaDevicesSource |
 *       |                    | --->
 *        --------------------
 */
export default class MediaDevicesSource extends TrackSource {
	constructor(outputCount) {
		super()

		this._addOutputTrackSlot('audio')
		this._addOutputTrackSlot('video')

		this._handleAudioInputIdChangedBound = this._handleAudioInputIdChanged.bind(this)
		this._handleVideoInputIdChangedBound = this._handleVideoInputIdChanged.bind(this)

		this._audioAllowed = true
		this._videoAllowed = true

		this._active = false
	}

	isAudioAllowed() {
		return this._audioAllowed
	}

	isVideoAllowed() {
		return this._videoAllowed
	}

	setAudioAllowed(audioAllowed) {
		if (this._audioAllowed === audioAllowed) {
			return
		}

		this._audioAllowed = audioAllowed

		if (!this._active) {
			return
		}

		if (audioAllowed) {
			this._handleAudioInputIdChangedBound(mediaDevicesManager, mediaDevicesManager.get('audioInputId'))

			return
		}

		if (this.getOutputTrack('audio')) {
			this.getOutputTrack('audio').stop()
		}
		this._setOutputTrack('audio', null)
	}

	setVideoAllowed(videoAllowed) {
		if (this._videoAllowed === videoAllowed) {
			return
		}

		this._videoAllowed = videoAllowed

		if (!this._active) {
			return
		}

		if (videoAllowed) {
			this._handleVideoInputIdChangedBound(mediaDevicesManager, mediaDevicesManager.get('videoInputId'))

			return
		}

		if (this.getOutputTrack('video')) {
			this.getOutputTrack('video').stop()
		}
		this._setOutputTrack('video', null)
	}

	async start(retryNoVideoCallback) {
		this._active = true
		this._reacquireOff = false
		this._reacquiredAt = []

		// Try to get the devices list before getting user media.
		mediaDevicesManager.enableDeviceEvents()
		mediaDevicesManager.disableDeviceEvents()

		// The handlers for "change:audioInputId" and "change:videoInputId"
		// events expect the initial "getUserMedia" call to have been completed
		// before being used, so they must be set once the media has started.

		const constraints = {
			audio: this._audioAllowed,
			video: this._videoAllowed,
		}

		let stream
		let error

		[stream, error] = await this._startAudioAndVideo(constraints)

		// Fallback for users without a camera or with a camera that can not be
		// accessed, but only if audio is meant to be used.
		if (error && constraints.audio !== false && constraints.video !== false) {
			const audioAndVideoError = error;

			[stream, error] = await this._startAudioOnly(constraints)

			// ket4tec NAS_CLOUD#98: a microphone that can not be opened
			// (denied, broken or a virtual device without source) must not
			// drop the camera too, so try video only before giving up.
			if (error) {
				const audioOnlyError = error;

				[stream, error] = await this._startAudioAndVideo({ audio: false, video: this._videoAllowed })
				if (error) {
					error = audioOnlyError
				}
			}

			// The camera is reported as failed only if it is not sent.
			if (!stream || stream.getVideoTracks().length === 0) {
				retryNoVideoCallback(audioAndVideoError)
			}
		}

		if (error) {
			// No media could be got, but the node is active nevertheless and
			// listening to device changes until explicitly stopped.
			mediaDevicesManager.on('change:audioInputId', this._handleAudioInputIdChangedBound)
			mediaDevicesManager.on('change:videoInputId', this._handleVideoInputIdChangedBound)

			throw error
		}

		// According to the specification "getUserMedia()" will return at
		// most a single track of each kind.
		const audioTrack = stream.getAudioTracks().length > 0 ? stream.getAudioTracks()[0] : null
		if (stream.getAudioTracks().length > 1) {
			console.error('More than a single audio track returned by getUserMedia, only the first one will be used')
		}

		const videoTrack = stream.getVideoTracks().length > 0 ? stream.getVideoTracks()[0] : null
		if (stream.getVideoTracks().length > 1) {
			console.error('More than a single video track returned by getUserMedia, only the first one will be used')
		}

		this._setOutputTrack('audio', audioTrack)
		this._setOutputTrack('video', videoTrack)

		mediaDevicesManager.on('change:audioInputId', this._handleAudioInputIdChangedBound)
		mediaDevicesManager.on('change:videoInputId', this._handleVideoInputIdChangedBound)
	}

	async _startAudioAndVideo(constraints) {
		this._adjustVideoConstraintsForChromium(constraints)

		let stream

		try {
			stream = await mediaDevicesManager.getUserMedia(constraints, 'callstart')
		} catch (error) {
			return [null, error]
		}

		// Although the promise should be resolved only if all the constraints
		// are met Edge resolves it if both audio and video are requested but
		// only audio is available.
		if (constraints.video && stream.getVideoTracks().length === 0) {
			return [null, Error('Video expected but not received')]
		}

		return [stream, null]
	}

	async _startAudioOnly(constraints) {
		constraints.video = false

		let stream

		try {
			stream = await mediaDevicesManager.getUserMedia(constraints, 'callstart')
		} catch (error) {
			return [null, error]
		}

		return [stream, null]
	}

	/**
	 * ket4tec NAS_CLOUD#172: iOS Safari сам завершает дорожку звонка (ended) — второй захват на странице,
	 * прерывание аудиосессии. Раньше слот пустел до перезахода: кнопка серая «Нет аудио», «Применить параметры»
	 * не помогало. Берём то же устройство заново; включена ли дорожка, решает TrackEnabler (вход — тихий).
	 *
	 * @param {MediaStreamTrack} track завершившаяся дорожка
	 */
	_removeTrackWhenEnded(track) {
		const kind = ['audio', 'video'].find((id) => this.getOutputTrack(id) === track)
		super._removeTrackWhenEnded(track)
		if (!kind || !this._active) {
			return
		}
		// ponytail: 3 перезахвата за 10 с — и больше не перезахватываем до следующего start(): две вкладки звонка
		// иначе отнимают устройство друг у друга без конца (NAS_CLOUD#279 п.5)
		const now = Date.now()
		this._reacquiredAt = (this._reacquiredAt || []).filter((at) => now - at < 10000)
		if (this._reacquireOff || this._reacquiredAt.length >= 3) {
			this._reacquireOff = true
			return
		}
		this._reacquiredAt.push(now)
		if (kind === 'audio') {
			this._handleAudioInputIdChangedBound(mediaDevicesManager, mediaDevicesManager.get('audioInputId'), 'callended')
		} else {
			this._handleVideoInputIdChangedBound(mediaDevicesManager, mediaDevicesManager.get('videoInputId'))
		}
	}

	stop() {
		if (this.getOutputTrack('audio')) {
			this.getOutputTrack('audio').stop()
			this._setOutputTrack('audio', null)
		}

		if (this.getOutputTrack('video')) {
			this.getOutputTrack('video').stop()
			this._setOutputTrack('video', null)
		}

		mediaDevicesManager.off('change:audioInputId', this._handleAudioInputIdChangedBound)
		mediaDevicesManager.off('change:videoInputId', this._handleVideoInputIdChangedBound)

		this._active = false
	}

	/**
	 * Adjusts video constraints to work around bug in Chromium.
	 *
	 * In Chromium it is not possible to increase the resolution of a track once
	 * it has been cloned, so the track needs to be initialized with a high
	 * resolution (otherwise real devices are initialized with a resolution
	 * around 640x480). Therefore, the video is requested with a loose
	 * constraint for a high resolution, so if the camera does not have such
	 * resolution it will still return the highest resolution available without
	 * failing.
	 *
	 * A high frame rate needs to be requested too, as some cameras offer high
	 * resolution but with low frame rates, so Chromium could end providing a
	 * laggy high resolution video. If the frame rate is requested too then
	 * Chromium needs to balance all the constraints and thus provide a video
	 * without the highest resolution but with an acceptable frame rate.
	 *
	 * @param {object} constraints the constraints to be adjusted
	 */
	_adjustVideoConstraintsForChromium(constraints) {
		if (!constraints.video) {
			return
		}

		if (!(constraints.video instanceof Object)) {
			constraints.video = {}
		}

		if (!isChromium) {
			Object.assign(constraints.video, START_VIDEO_CONSTRAINTS)
			return
		}

		constraints.video.width = 1920
		constraints.video.height = 1200
		constraints.video.frameRate = 60
	}

	_handleAudioInputIdChanged(mediaDevicesManager, audioInputId, source = 'callchange') {
		if (!this._audioAllowed) {
			return
		}

		if (this._pendingAudioInputIdChangedCount) {
			this._pendingAudioInputIdChangedCount++

			return
		}

		this._pendingAudioInputIdChangedCount = 1

		const resetPendingAudioInputIdChangedCount = () => {
			const audioInputIdChangedAgain = this._pendingAudioInputIdChangedCount > 1

			this._pendingAudioInputIdChangedCount = 0

			if (audioInputIdChangedAgain) {
				this._handleAudioInputIdChanged(mediaDevicesManager, mediaDevicesManager.get('audioInputId'))
			}
		}

		if (audioInputId === null) {
			if (this.getOutputTrack('audio')) {
				this.getOutputTrack('audio').stop()
			}
			this._setOutputTrack('audio', null)

			resetPendingAudioInputIdChangedCount()

			return
		}

		if (this.getOutputTrack('audio')) {
			const settings = this.getOutputTrack('audio').getSettings()
			if (settings && settings.deviceId === audioInputId) {
				resetPendingAudioInputIdChangedCount()

				return
			}
		}

		mediaDevicesManager.getUserMedia({ audio: true }, source).then((stream) => {
			// ket4tec NAS_CLOUD#279: источник остановлен, пока шёл getUserMedia — дорожку не берём, гасим
			if (!this._active) {
				stream.getTracks().forEach((t) => t.stop())
				resetPendingAudioInputIdChangedCount()

				return
			}

			// According to the specification "getUserMedia({ audio: true })" will
			// return a single audio track.
			const track = stream.getTracks()[0]
			if (stream.getTracks().length > 1) {
				console.error('More than a single audio track returned by getUserMedia, only the first one will be used')
			}

			if (this.getOutputTrack('audio')) {
				this.getOutputTrack('audio').stop()
			}
			this._setOutputTrack('audio', track)

			resetPendingAudioInputIdChangedCount()
		}).catch(() => {
			if (this.getOutputTrack('audio')) {
				this.getOutputTrack('audio').stop()
			}
			this._setOutputTrack('audio', null)

			resetPendingAudioInputIdChangedCount()
		})
	}

	_handleVideoInputIdChanged(mediaDevicesManager, videoInputId) {
		if (!this._videoAllowed) {
			return
		}

		if (this._pendingVideoInputIdChangedCount) {
			this._pendingVideoInputIdChangedCount++

			return
		}

		this._pendingVideoInputIdChangedCount = 1

		const resetPendingVideoInputIdChangedCount = () => {
			const videoInputIdChangedAgain = this._pendingVideoInputIdChangedCount > 1

			this._pendingVideoInputIdChangedCount = 0

			if (videoInputIdChangedAgain) {
				this._handleVideoInputIdChanged(mediaDevicesManager, mediaDevicesManager.get('videoInputId'))
			}
		}

		if (videoInputId === null) {
			if (this.getOutputTrack('video')) {
				this.getOutputTrack('video').stop()
			}
			this._setOutputTrack('video', null)

			resetPendingVideoInputIdChangedCount()

			return
		}

		if (this.getOutputTrack('video')) {
			const settings = this.getOutputTrack('video').getSettings()
			if (settings && settings.deviceId === videoInputId) {
				resetPendingVideoInputIdChangedCount()

				return
			}
		}

		const constraints = { video: true }
		this._adjustVideoConstraintsForChromium(constraints)

		mediaDevicesManager.getUserMedia(constraints).then((stream) => {
			// ket4tec NAS_CLOUD#279: источник остановлен, пока шёл getUserMedia — дорожку не берём, гасим
			if (!this._active) {
				stream.getTracks().forEach((t) => t.stop())
				resetPendingVideoInputIdChangedCount()

				return
			}

			// According to the specification "getUserMedia({ video: true })" will
			// return a single video track.
			const track = stream.getTracks()[0]
			if (stream.getTracks().length > 1) {
				console.error('More than a single video track returned by getUserMedia, only the first one will be used')
			}

			if (this.getOutputTrack('video')) {
				this.getOutputTrack('video').stop()
			}
			this._setOutputTrack('video', track)

			resetPendingVideoInputIdChangedCount()
		}).catch(() => {
			if (this.getOutputTrack('video')) {
				this.getOutputTrack('video').stop()
			}
			this._setOutputTrack('video', null)

			resetPendingVideoInputIdChangedCount()
		})
	}
}
