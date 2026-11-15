// Стенд NAS_CLOUD#239: ?mode=before — старт как раньше вне Chromium ({ video: true }), ?mode=after — START_VIDEO_CONSTRAINTS.
// ?level=off|auto — кадр по лицу. Журнал размеров кадра: window.__cam.log
import FaceFrame, { setFaceFrameLevel } from '../src/utils/media/pipeline/FaceFrame.js'
import { START_VIDEO_CONSTRAINTS } from '../src/utils/media/pipeline/MediaDevicesSource.js'
import TrackConstrainer from '../src/utils/media/pipeline/TrackConstrainer.js'
import TrackToStream from '../src/utils/media/pipeline/TrackToStream.js'
import { QUALITY, VideoConstrainer } from '../src/utils/webrtc/VideoConstrainer.js'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') || 'after'
setFaceFrameLevel(params.get('level') || 'off', { persist: false })

const tile = document.getElementById('tile')
const constrainer = new TrackConstrainer()
const ff = new FaceFrame()
const tts = new TrackToStream()
tts.addInputTrackSlot('video')
constrainer.connectTrackSink('default', ff)
ff.connectTrackSink('default', tts, 'video')
tts.on('streamSet', (_t, stream) => {
	tile.srcObject = stream
})

const t0 = performance.now()
const log = []
const cam = (window.__cam = { mode, log, changes: 0 })
let last = ''
/**
 *
 */
function sample() {
	const raw = constrainer.getOutputTrack()?.getSettings() ?? {}
	const row = `${tile.videoWidth}x${tile.videoHeight} raw ${raw.width}x${raw.height}`
	if (row !== last) {
		cam.changes += last && tile.videoWidth ? 1 : 0
		last = row
		log.push(`${Math.round(performance.now() - t0)} мс  плитка ${row}  путь ${ff.path}`)
		document.getElementById('log').textContent = `режим: ${mode}\n` + log.join('\n')
	}
}
setInterval(sample, 20)

const video = mode === 'before' ? true : { ...START_VIDEO_CONSTRAINTS }
navigator.mediaDevices.getUserMedia({ video }).then((stream) => {
	constrainer._setInputTrack('default', stream.getVideoTracks()[0])
	// SentVideoQualityThrottler применяет качество сразу, как только видео доступно
	setTimeout(() => new VideoConstrainer(constrainer).applyConstraints(QUALITY.HIGH).then(() => {
		cam.applied = Math.round(performance.now() - t0)
	}), 300)
}).catch((e) => {
	cam.error = e.name + ': ' + e.message
	document.getElementById('log').textContent = cam.error
})
