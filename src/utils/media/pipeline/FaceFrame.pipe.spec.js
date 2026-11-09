/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, describe, expect, test, vi } from 'vitest'
import FaceFrame from './FaceFrame.js'
import TrackToStream from './TrackToStream.js'

vi.mock('@mediapipe/tasks-vision', () => ({}))

describe('FaceFrame в цепочке превью', () => {
	beforeAll(() => {
		window.MediaStream = function() {
			this._tracks = []
			this.addTrack = (t) => this._tracks.push(t)
			this.removeTrack = (t) => this._tracks.splice(this._tracks.indexOf(t), 1)
			this.getTracks = () => this._tracks
		}
	})
	test('«Выкл»: поток в TrackToStream появляется сразу после установки трека', () => {
		const ff = new FaceFrame()
		const tts = new TrackToStream()
		tts.addInputTrackSlot('video')
		ff.connectTrackSink('default', tts, 'video')
		const track = { id: 'v', kind: 'video', enabled: true, readyState: 'live', addEventListener() {}, removeEventListener() {} }
		ff._setInputTrack('default', track)
		expect(ff.getOutputTrack()).toBe(track)
		expect(tts.getStream()?.getTracks()).toEqual([track])
	})
})
