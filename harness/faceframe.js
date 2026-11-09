import FaceFrame, { getFaceFrameLevel, onFaceFrameLevelChange, setFaceFrameLevel } from '../src/utils/media/pipeline/FaceFrame.js'
import TrackToStream from '../src/utils/media/pipeline/TrackToStream.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
const ff = new FaceFrame()
const tts = new TrackToStream()
tts.addInputTrackSlot('video')
ff.connectTrackSink('default', tts, 'video')
tts.on('streamSet', (_t, stream) => {
	$('preview').srcObject = stream
})
let rawTrack = null

// ?fake=1: синтетическая «камера» (канвас 1280x720, 30 кадров/с) для движков без камеры (Playwright WebKit)
if (params.get('fake')) {
	const c = document.createElement('canvas')
	c.width = 1280
	c.height = 720
	const g = c.getContext('2d')
	const draw = (t) => {
		g.fillStyle = '#245'
		g.fillRect(0, 0, c.width, c.height)
		g.fillStyle = '#fc8'
		g.beginPath()
		g.ellipse(640 + Math.sin(t / 900) * 300, 360, 90, 120, 0, 0, 7)
		g.fill()
		g.fillStyle = '#fff'
		g.font = '48px sans-serif'
		g.fillText(String(Math.round(t)), 40, 80)
		requestAnimationFrame(draw)
	}
	requestAnimationFrame(draw)
	const fakeStream = c.captureStream(30)
	navigator.mediaDevices.getUserMedia = async () => fakeStream
}

/**
 *
 */
async function listCams() {
	const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
	$('cam').innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'камера ' + (i + 1)}</option>`).join('')
}

/**
 *
 */
async function start() {
	rawTrack?.stop()
	const deviceId = $('cam').value
	const stream = await navigator.mediaDevices.getUserMedia({
		video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }), width: { ideal: 1280 }, height: { ideal: 720 } },
	})
	await listCams()
	rawTrack = stream.getVideoTracks()[0]
	ff._setInputTrack('default', rawTrack)
	$('preview').play().catch(() => {})
}

$('level').value = getFaceFrameLevel()
$('level').onchange = () => setFaceFrameLevel($('level').value)
onFaceFrameLevelChange(() => {
	$('level').value = getFaceFrameLevel()
})
$('start').onclick = () => start().catch((e) => {
	$('stats').textContent = 'ошибка: ' + e.message
})

setInterval(() => {
	const s = window.__k4ffStats
	const v = $('preview')
	const digital = ff.path === 'digital' && s
	$('stats').textContent = `путь: ${ff.path}   уровень: ${getFaceFrameLevel()}\n`
		+ `fps выхода: ${digital ? s.fps : '-'}\n`
		+ `детектор: ${digital ? `${s.detAvg} / ${s.detP95} мс (avg/p95), n=${s.detCount}` : '-'}\n`
		+ `планировщик: ${digital ? s.scheduler : '-'}   превью: ${v.videoWidth}x${v.videoHeight}`
	window.__harness = { path: ff.path, level: getFaceFrameLevel(), stats: s, preview: [v.videoWidth, v.videoHeight, v.readyState] }
}, 250)

if (params.get('auto')) {
	listCams().then(() => start())
} else {
	listCams()
}
